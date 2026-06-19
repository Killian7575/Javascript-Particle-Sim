
import { ParticleContainer, Particle, Texture } from 'pixi.js';
import type { ParticleSimulator } from '../sim/simulation';

export class Renderer {
  readonly container: ParticleContainer;        // main.ts adds this to app.stage
  private readonly renderParticles: Particle[] = [];
  private readonly texture: Texture;
  private palette: number[];                     // hex tint per type index

  constructor(sim: ParticleSimulator) {
    this.texture = (() => {
      const diameter = 8
      const radius = diameter/2
      const canvas = document.createElement('canvas');
      canvas.width = diameter;
      canvas.height = diameter;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createRadialGradient(radius,radius,0,radius,radius,radius);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');   // opaque centre
      gradient.addColorStop(1, 'rgba(255,255,255,0)');   // transparent edge
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.fillRect(0, 0, diameter, diameter)
      ctx.fill();
      return Texture.from(canvas);
    })();
    this.container = new ParticleContainer({
      dynamicProperties: { // Verbose, all these values are also the default
        position: true,  // Update positions each frame
        rotation: false,  // static rotation
        vertex: false,   // Static vertices
        uvs: false,     // Static texture coordinates
        color: false     // Static colors
      },
      blendMode: 'add'
    });
    this.palette = buildPalette(sim.typeCount)
    for (let i = 0; i < sim.particleCount; i++) {
      const p = new Particle({
        texture: this.texture,
        x: sim.posX[i],
        y: sim.posY[i],
        anchorX: 0.5,
        anchorY: 0.5,
        tint: this.palette[sim.type[i]]
      })
      this.renderParticles.push(p)
      this.container.addParticle(p)
    }
  }

  /** Per frame, after sim.update(): copy positions maths -> pixels. */
  sync(sim: ParticleSimulator) {
    for (let i = 0; i < sim.particleCount; i++) {
      this.renderParticles[i].x = sim.posX[i];
      this.renderParticles[i].y = sim.posY[i];
    }
  }

  /** Tints are static, so re-apply them only when type[] changes */
  refreshTints(sim: ParticleSimulator) {
    for (let i = 0; i < sim.particleCount; i++) {
      this.renderParticles[i].tint = this.palette[sim.type[i]]
    }
    this.container.update()
  }
}

// Build evenly spaces set of colours based on number of particles 
function buildPalette(typesCount: number): number[] {

  let colors: number[] = [];
  for (let i = 0; i < typesCount; i++) {
    let {r, g, b} = HSLtoRGB(360 / typesCount * i, 100, 60)
    colors.push(+RGBToHex(r, g, b))
  }
  return colors;
}

function HSLtoRGB(h:number, s: number, l: number ) {
  s /= 100;
  l /= 100;

  let c = (1 - Math.abs(2 * l - 1)) * s,
      x = c * (1 - Math.abs((h / 60) % 2 - 1)),
      m = l - c/2,
      r = 0,
      g = 0,
      b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;  
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return {r, g, b};
}

function RGBToHex(r: any, g: any, b: any) { // (r: any) because otherwise i need a set of vars to save the string versions
  r = r.toString(16);
  g = g.toString(16);
  b = b.toString(16);

  if (r.length == 1)
    r = "0" + r;
  if (g.length == 1)
    g = "0" + g;
  if (b.length == 1)
    b = "0" + b;

  return "0x" + r + g + b;
}