// =============================================================================
// render.ts — the DRAWING. Owns every PixiJS object; does no physics.
//
// The mirror image of simulation.ts: it imports Pixi freely, but imports the
// simulator ONLY as a type. It READS the sim's position buffers each frame and
// copies them onto the GPU mirror. Colour lives here (a tint is a render concern,
// not a physics one), which is why buildPalette is here and not in rules.ts.
// =============================================================================

import { ParticleContainer, Particle, Texture } from 'pixi.js';
import type { ParticleSimulator } from './simulation.ts';
//     ^^^^ verbatimModuleSyntax (tsconfig.json:12) REQUIRES `type` here: we use
//          ParticleSimulator only in annotations, never as a runtime value.

export class Renderer {
  readonly container: ParticleContainer;        // main.ts adds this to app.stage
  private readonly renderParticles: Particle[] = [];
  private readonly texture: Texture;
  private palette: number[];                     // hex tint per type index

  constructor(sim: ParticleSimulator) {
    // TODO (you):
    //   - move your baseTexture block here (main.ts:28-38)        -> this.texture
    //   - this.container = new ParticleContainer({ dynamicProperties: { position: true, ... } })
    //       (your existing config, main.ts:58-67)
    //   - this.palette = buildPalette(sim.numTypes)
    //   - for i in 0..sim.count:
    //       const p = new Particle({ texture: this.texture, tint: this.palette[sim.type[i]],
    //                                anchorX: 0.5, anchorY: 0.5 });    // your main.ts:87-94
    //       this.renderParticles.push(p);  this.container.addParticle(p);

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
    this.palette = buildPalette(sim.numTypes)
    for (let i = 0; i < sim.count; i++) {
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

  /** Per frame, AFTER sim.update(): copy positions maths -> pixels. */
  sync(sim: ParticleSimulator) {
    // TODO (you): for i -> renderParticles[i].x = sim.posX[i]; .y = sim.posY[i];
    // NO container.update() here: position is dynamic (main.ts:59), synced to GPU automatically.
    for (let i = 0; i < sim.count; i++) {
      this.renderParticles[i].x = sim.posX[i];
      this.renderParticles[i].y = sim.posY[i];
    }
  }

  /** Tints are static, so re-apply them only when type[] changes (M6 reseed/setNumTypes). */
  refreshTints(sim: ParticleSimulator) {
    // TODO (you): for i -> renderParticles[i].tint = this.palette[sim.type[i]];
    //             THEN this.container.update();  (static change => must call update)
    for (let i = 0; i < sim.count; i++) {
      this.renderParticles[i].tint = this.palette[sim.type[i]]
    }
    this.container.update()
  }
}

// Not exported => private to this file (the TS-enforced version of Python's `_name`).
function buildPalette(numTypes: number): number[] {
  // TODO (you) M2: generate `numTypes` evenly-spaced hues across 360° and convert each
  // to a 0xRRGGBB hex number.
  //
  // Conceptual steps (not the code — you write it):
  //   1. For index i, compute a hue: spread i evenly across [0, 360).
  //   2. Convert HSL (that hue, high saturation, ~60% lightness) to RGB.
  //      Hint: browsers expose this through a canvas or CSS — but you can also
  //      compute it directly with the HSL-to-RGB formula (plenty of references online).
  //   3. Pack the three 0-255 channel values into a single 0xRRGGBB number:
  //        (r << 16) | (g << 8) | b
  //   4. Push each result into an array and return it.
  //
  // When this works, buildPalette(3) should give you roughly your current blue/red/green,
  // and buildPalette(6) should give you six visually distinct colours.

  let colors: number[] = [];
  for (let i = 0; i < numTypes; i++) {
    let {r, g, b} = HSLtoRGB(360 / numTypes * i, 100, 60)
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