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
    //   - assign count / numTypes / width / height to the fields above --- DONE
    //   - allocate posX/posY/velX/velY (Float32Array), type (Uint8Array), 
    //     and accX/accY (Float32Array), all at length `count` --- DONE
    //   - this.seed(); --- DONE

    this.count = count;
    this.numTypes = numTypes;
    this.width = width;
    this.height = height;

    this.posX = new Float32Array(count);
    this.posY = new Float32Array(count);
    this.velX = new Float32Array(count);
    this.velY = new Float32Array(count);
    this.type = new Uint8Array(count);

    this.accX = new Float32Array(count);
    this.accY = new Float32Array(count);

    this.seed()
  }

  /** (Re)randomise positions and types in place; zero velocities. */
  seed() {
    // TODO (you): your old initParticles fill (main.ts:84-97) MINUS the Pixi part:
    //   posX[i] = random in [0, width);  posY[i] = random in [0, height); --- DONE
    //   type[i] = random integer 0..numTypes-1;  velX[i] = velY[i] = 0. ---

    for (let i = 0; i < this.count; i++) {
      this.posX[i] = Math.random() * this.width;
      this.posY[i] = Math.random() * this.height;
      this.type[i] = Math.floor(Math.random() * this.numTypes);

      this.velX[i] = 0;
      this.velY[i] = 0;
    }

  }

  /** Advance the sim by `dt` (PixiJS ticker.deltaTime; 1 == one frame @60fps). */
  update(dt: number) {
    // Hoist this.* to locals ONCE so the hot loop touches locals, not this.posX[i]:
    //   const { posX, posY, velX, velY, accX, accY, count } = this; --- DONE

    // TODO (you): the same maths as your old updateParticles (main.ts:222-273), on arrays:
    //   1. zero accX / accY --- DONE
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

    const { posX, posY, velX, velY, accX, accY, count, type, rMax, beta, width, height, friction } = this;
    accX.fill(0);
    accY.fill(0);
    const liveFriction = Math.pow(friction, dt/60)

    for (let i = 0; i < count; i++){
      for (let j = 0; j < count; j++) {
        if (i != j) {
          
          // Compute vector direction
          const dx = posX[j] - posX[i];
          const dy = posY[j] - posY[i];
          // Zero magnitude guard
          if (dx === 0 && dy === 0) continue;
          // Compute magnitude, named as distance
          const distance = Math.sqrt(dx ** 2 + dy ** 2);
          // Compute normalised vector
          const nx = dx / distance;
          const ny = dy / distance;
          // Affinity coefficient, temp as switch case
          const a: number = this.tempSwitch(type[i], type[j]);
          // Compute force
          const f = force(distance, a, rMax, beta);
          // Accumulate 
          accX[i] += f * nx;
          accY[i] += f * ny; 
        } // note to self: after M3 check if 2 particles with same pos, type and vel ever separate
      }
      // accumulate velocity
      velX[i] += accX[i] * dt;
      velY[i] += accY[i] * dt;
      // apply velocity to pos
      posX[i] += velX[i] * dt;
      posY[i] += velY[i] * dt;
      // bounce off edge
      if (posX[i] > width) {
        posX[i] = width;
        velX[i] *= -1
      } else if (posX[i] < 0) {
        posX[i] = 0
        velX[i] *= -1
      }
      if (posY[i] > height) {
        posY[i] = height;
        velY[i] *= -1
      } else if (posY[i] < 0) {
        posY[i] = 0
        velY[i] *= -1
      }
      velX[i] *= liveFriction;
      velY[i] *= liveFriction;
    }

  }
  tempSwitch(p1: number, p2: number) {
    // IMPORTANT:
    // I'm aware this is inefficient to call in hot loop
    // This switch takes a lot screen space, so putting it here makes working on the file easier and easier to remove when its time to
    let a = 0
    if (p1 >= 3 || p2 >= 3) {
      // more than 3 types out of scope till switch is moved away from
      return a
    }
    switch (p2) { // Planned: implement UI for live adjustment of magic number, lowest priority
      case 0:
        switch (p1) {
          case 0: // blue effect on blue
            a = -0.05 //repen
            
            break;
          case 1: // blue effect on red
            a = 1// attract
           
            break; 
          case 2: // blue effect on green
            a = -0.5// repel
            
            break;
        }
        break;
      case 1:
        switch (p1) {
          case 0: // red effect on blue
            a = 1// attract
            
            break;
          case 1: // red effect on red
            a = 0.75// attract
            
            break; 
          case 2: // red effect on green
            a = -0.5// repel
            
            break;
        }
        break;
      case 2:
        switch (p1) {
          case 0: // green effect on blue
            a = 1// attract
            
            break;
          case 1: // green effect on red
            a = 1// attract
            
            break; 
          case 2: // green effect on green
            a = -0.5// repel
            
            break;
        }
        break;
      }
    return a;
  }
  
}
