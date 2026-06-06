// =============================================================================
// simulation.ts — the PHYSICS. Pure maths over flat typed arrays (Structure of Arrays).
//
// HARD RULE: this file imports NOTHING from 'pixi.js'. It deals in numbers, not
// pixels. That Pixi-free boundary is what makes it (a) unit-testable in isolation
// and (b) the drop-in seam for the future WASM/WebGPU port
// (PARTICLE_LIFE_PLAN.md:88-100, :342). The renderer READS our position buffers
// after update(); we never touch a Pixi object here.
// =============================================================================

import { force } from './rules.ts';
//       ^ VALUE import (we call force() at runtime), so NOT `import type`.

export class ParticleSimulator {
  // --- SoA state: particle i is (posX[i], posY[i], velX[i], velY[i], type[i]) ---
  // `readonly` = the buffer REFERENCE is fixed for this sim's lifetime (you still
  // mutate its elements freely). To change `count`, build a NEW ParticleSimulator
  // (see main.ts). Mental model: structural change -> new object; tuning -> set a field.
  readonly posX: Float32Array;
  readonly posY: Float32Array;
  readonly velX: Float32Array;
  readonly velY: Float32Array;
  readonly type: Uint8Array;            // particle type index 0..numTypes-1

  // --- reused force accumulators: allocate ONCE; `new` in a 60fps loop = GC stutter ---
  private readonly accX: Float32Array;
  private readonly accY: Float32Array;

  // --- counts + tunables (lil-gui binds straight to these fields at M6) ---
  count: number;
  numTypes: number;
  rMax = 100;          // interaction radius (== future CELL_SIZE at M5)
  beta = 0.3;          // fraction of rMax that is pure repulsion (M3)
  friction = 0.15;     // was targetFriction (main.ts:24)
  width: number;       // integrator clamps to these; main passes app.screen.*
  height: number;

  // Born at M2 — the rules MATRIX is state, so it lives here, on the sim:
  // rules!: Float32Array;   // numTypes*numTypes, each in [-1, 1]

  constructor(count: number, numTypes: number, width: number, height: number) {
    // NOTE: no `constructor(public count: number, ...)` shorthand — parameter
    // properties are banned by erasableSyntaxOnly (tsconfig.json:19). Assign by hand.
    // TODO (you):
    //   - assign count / numTypes / width / height to the fields above
    //   - allocate posX/posY/velX/velY (Float32Array), type (Uint8Array),
    //     and accX/accY (Float32Array), all at length `count`
    //   - this.seed();
  }

  /** (Re)randomise positions and types in place; zero velocities. */
  seed() {
    // TODO (you): your old initParticles fill (main.ts:84-97) MINUS the Pixi part:
    //   posX[i] = random in [0, width);  posY[i] = random in [0, height);
    //   type[i] = random integer 0..numTypes-1;  velX[i] = velY[i] = 0.
  }

  /** Advance the sim by `dt` (PixiJS ticker.deltaTime; 1 == one frame @60fps). */
  update(dt: number) {
    // Hoist this.* to locals ONCE so the hot loop touches locals, not this.posX[i]:
    //   const { posX, posY, velX, velY, accX, accY, count } = this;

    // TODO (you): the same maths as your old updateParticles (main.ts:222-273), on arrays:
    //   1. zero accX / accY
    //   2. for i, for j != i:
    //        - geometry inline: dx, dy, dist, and the unit direction nx, ny
    //          (this is your normaliseVector body, main.ts:108-114, inlined)
    //        - coefficient: M1 -> a switch on (type[i], type[j]) reproducing your
    //          applyRules coefficients (main.ts:167-216), keyed on index not tint;
    //          M2 -> a = this.rules[type[i] * numTypes + type[j]]  (in-place swap)
    //        - f = force(dist, a, this.rMax, this.beta);
    //          accX[i] += f * nx;  accY[i] += f * ny;
    //        - M3: add `if (dx*dx + dy*dy > rMax*rMax) continue;` BEFORE the sqrt
    //        - M5: replace the inner `for j` with the 3x3 spatial-grid walk
    //   3. velX[i] += accX[i] * dt;  velY[i] += accY[i] * dt
    //   4. posX[i] += velX[i] * dt;  posY[i] += velY[i] * dt
    //   5. boundaries (your bounce, main.ts:253-268) + friction (Math.pow, main.ts:235)
    // No Pixi here. main.ts calls renderer.sync(this) AFTER this returns.
  }
}
