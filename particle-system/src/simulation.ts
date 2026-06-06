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
  speed = 0.1;
  rMax = 100;          // interaction radius (== future CELL_SIZE at M5)
  beta = 0.3;          // fraction of rMax that is pure repulsion (M3)
  friction = 0.05;     // was targetFriction (main.ts:24)
  width: number;       // integrator clamps to these; main passes app.screen.*
  height: number;

  // Born at M2 — the rules MATRIX is state, so it lives here, on the sim.
  // rules[a * numTypes + b] answers "how does type a feel toward type b?"
  // The `!` tells TS "assigned before first use" (we call initRules in constructor).
  rules!: Float32Array;   // numTypes*numTypes, each in [-1, 1]

  constructor(count: number, numTypes: number, width: number, height: number) {

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

    this.rules = new Float32Array(numTypes * numTypes);
    this.initRules();
    this.seed();
  }

  /**
   * Populate the rules matrix with initial hand-set values that reproduce
   * the feel of your old tempSwitch behaviour (for eyeball-verification that
   * the table lookup gives the same result as the switch did).
   *
   * Row = the type that FEELS the force (index i in the pair loop).
   * Col = the type that CAUSES the force (index j).
   * So `rules[a * numTypes + b]` = "how does type a respond to nearby type b?"
   *
   * Example of the 2D → 1D indexing for a 3-type system (numTypes = 3):
   *
   *           b=0   b=1   b=2
   *   a=0  [  0,    1,    2  ]
   *   a=1  [  3,    4,    5  ]
   *   a=2  [  6,    7,    8  ]
   *
   *   rules[1 * 3 + 2] = rules[5]  → "how does type 1 feel toward type 2?"
   *
   * Tip: read the body of tempSwitch below carefully. For each (p1, p2) case,
   * the `a` value it returns is the entry you need at rules[p1 * numTypes + p2].
   */
  initRules() {
    // TODO (you): fill this.rules[a * this.numTypes + b] for every (a, b) pair.
    // Start by translating each `case` in tempSwitch into one table assignment.
    // When you're done, the sim should look identical with tempSwitch removed.
    /* Cool rule sets:
    1. with legacy force curve [ -0.7824554443359375, -0.5159652233123779, -0.7399479150772095, 0.7869302034378052, -0.7077521681785583, 0.7734294533729553, -0.9772785305976868, 0.8419510126113892, -0.7135220766067505 ]
    
       OG rule set:
    1. [-0.05, 1, 1, 1, 0.75, 1, -0.5, -0.5, -0.5]
    */
    this.rules = new Float32Array([ -0.7824554443359375, -0.5159652233123779, -0.7399479150772095, 0.7869302034378052, -0.7077521681785583, 0.7734294533729553, -0.9772785305976868, 0.8419510126113892, -0.7135220766067505 ])
    // for (let i = 0; i < this.rules.length; i++) { // randomiser for later
    //   this.rules[i] = Math.random() * 2 - 1;
    // }
    // console.log(this.rules) // a way to save cool rulesets
  }

  /** (Re)randomise positions and types in place; zero velocities. */
  seed() {

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
    // No Pixi here. main.ts calls renderer.sync(this) AFTER this returns.

    const { posX, posY, velX, velY, accX, accY, count, type, rMax, beta, width, height, friction, rules, numTypes, speed } = this;
    accX.fill(0);
    accY.fill(0);
    const liveFriction = Math.pow(friction, dt/60)
    // i affected by j logic
    for (let i = 0; i < count; i++){
      for (let j = 0; j < count; j++) {
        if (i !== j) {
          
          // Compute vector direction
          const dx = posX[j] - posX[i];
          const dy = posY[j] - posY[i];
          // Zero magnitude guard
          if (dx === 0 && dy === 0) continue;
          // Too far away to matter
          if (dx*dx + dy*dy > rMax*rMax) continue;
          // Compute magnitude, named as distance
          const distance = Math.sqrt(dx ** 2 + dy ** 2);
          // Compute normalised vector
          const nx = dx / distance;
          const ny = dy / distance;
          // Affinity coefficient.
          const a: number = rules[type[i] * numTypes + type[j]]
          // Compute force
          const f = force(distance, a, rMax, beta);
          // Accumulate 
          accX[i] += f * nx * speed;
          accY[i] += f * ny * speed; 
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
}
