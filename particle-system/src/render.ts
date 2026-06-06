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
    //   - tint is a STATIC property (color:false, main.ts:64) -> call
    //     this.container.update() ONCE after the loop so the GPU picks the tints up.
  }

  /** Per frame, AFTER sim.update(): copy positions maths -> pixels. */
  sync(sim: ParticleSimulator) {
    // TODO (you): for i -> renderParticles[i].x = sim.posX[i]; .y = sim.posY[i];
    // NO container.update() here: position is dynamic (main.ts:59), synced to GPU for free.
  }

  /** Tints are static, so re-apply them only when type[] changes (M6 reseed/setNumTypes). */
  refreshTints(sim: ParticleSimulator) {
    // TODO (you): for i -> renderParticles[i].tint = this.palette[sim.type[i]];
    //             THEN this.container.update();  (static change => must call update)
  }
}

// Not exported => private to this file (the TS-enforced version of Python's `_name`).
function buildPalette(numTypes: number): number[] {
  // TODO (you):
  //   M1: return your three COLORS (main.ts:4-8) as an index list, e.g. [BLUE, RED, GREEN],
  //       so the look is preserved while type is now an index, not a tint.
  //   M2: numTypes evenly-spaced HSL hues -> hex (PARTICLE_LIFE_PLAN.md:205-208).
  return [];
}
