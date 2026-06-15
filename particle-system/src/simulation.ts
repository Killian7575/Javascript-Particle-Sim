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
const BENCH_ENABLED = import.meta.env.DEV;

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

  // --- performance ---
  private pStart: number[] = [];
  private pEnd: number[] = [];
  private pTotalAverage: number[] = [];
  private pOutputTime: number | undefined = undefined;

  // --- spatial grid (M5): rebuilt every frame in buildGrid() ---
  // cellMap: cell index -> array of particle indices in that cell.
  // cellCols / cellRows: grid dimensions (computed from width/height and rMax).
  private cellMap: Map<number, number[]> = new Map();
  private cellCols = 0;
  private cellRows = 0;

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

  /**
   * Bin every particle into a flat grid so the pair loop only checks the 3×3
   * block of cells around each particle.  Cell side = rMax guarantees that any
   * in-range neighbour is within that block (max distance == one cell side).
   */
  private buildGrid(): void {
    const { posX, posY, count, rMax, width, height } = this;
    let { cellMap } = this;

    // TODO (you): Step 1 — compute this.cellCols and this.cellRows.
    //   You need enough columns to cover the full width; Math.ceil handles the
    //   edge (a cell that starts inside the field must exist even if it only
    //   partially covers the right/bottom boundary).
    //   Question to answer: if width=500 and rMax=100, how many columns do you need?
    this.cellCols = Math.ceil(width / rMax);
    this.cellRows = Math.ceil(height / rMax);

    // TODO (you): Step 2 — clear this.cellMap so no stale indices from last frame remain.
    //   The Map has a method for this.
    cellMap.clear();

    // TODO (you): Step 3 — for every particle i, compute its cell and add it to the map.
    //   a. cx = Math.floor(posX[i] / rMax)   — which column does it sit in?
    //   b. cy = Math.floor(posY[i] / rMax)   — which row?
    //   c. flat index = cx + cy * this.cellCols   (same row*width+col as the rule matrix)
    //   d. If this.cellMap already has an array at that index, push i into it.
    //      Otherwise create a fresh [i] array at that key.
    //      Hint: Map.has / Map.get / Map.set, or a single Map.get with a fallback.
    for (let i = 0; i < count; i++){
      const cx = Math.floor(posX[i] / rMax);
      const cy = Math.floor(posY[i] / rMax);

      const cellIndex = cx + cy * this.cellCols;
      const cell = cellMap.get(cellIndex)

      if (cell) {
        cell.push(i)
      } else {
        cellMap.set(cellIndex, [i])
      }
    }
    

  }

  /** Advance the sim by `dt` (PixiJS ticker.deltaTime; 1 == one frame @60fps). */
  update(dt: number) {
    // Hoist this.* to locals ONCE so the hot loop touches locals, not this.posX[i]:
    //   const { posX, posY, velX, velY, accX, accY, count } = this; --- DONE
    // No Pixi here. main.ts calls renderer.sync(this) AFTER this returns.

    const { posX, posY, velX, velY, accX, accY, count, type, rMax, beta, width, height, friction, rules, numTypes, speed } = this;

    this.buildGrid();
    const { cellMap, cellCols, cellRows } = this;

    // --- performance check ---
    // let { pStart, pEnd, pTotalAverage } = this
    
    

    accX.fill(0);
    accY.fill(0);
    const liveFriction = Math.pow(friction, dt/60)

    

    function processPair(pi: number, pj: number): void {
      const dx = posX[pj] - posX[pi];
      const dy = posY[pj] - posY[pi];
      // Zero magnitude guard
      if (dx === 0 && dy === 0) return;
      // Too far away to matter
      if (dx*dx + dy*dy > rMax*rMax) return;
      // Compute magnitude, named as distance
      const distance = Math.sqrt(dx ** 2 + dy ** 2);
      // Compute normalised vector
      const nx = dx / distance;
      const ny = dy / distance;
      // Affinity coefficient.
      const a: number = rules[type[pi] * numTypes + type[pj]]
      // Compute force
      const f = force(distance, a, rMax, beta);
      // Accumulate 
      accX[pi] += f * nx * speed;
      accY[pi] += f * ny * speed; 

      // Again but j affected by i
      const a2: number = rules[type[pj] * numTypes + type[pi]]
      const f2 = force(distance, a2, rMax, beta);
      // Accumulate 
      accX[pj] += f2 * -nx * speed;
      accY[pj] += f2 * -ny * speed;
    }
    function process2ParticleBuckets(b1: number[], b2: number[]) {
      if (b2.length > 0 && b1.length > 0)  {
        for (let i = 0; i < b1.length; i++){
          for (let j = 0; j < b2.length; j++) {
            processPair(b1[i], b2[j])
          }
        }
      }
    }

    function processWithinBucket(b: number[]) {
      for (let i = 0; i < b.length; i++){
        for (let j = 0; j < b.length; j++) {
          if (j > i) {
            processPair(b[i], b[j])
          }
        }
      }
    }


    // TODO (you) M5: replace the inner j-loop below with a 3×3 grid walk.
    //   For each i: find its cell, walk the 9 neighbour cells, iterate each bucket.
    //   Use j > i to process each pair once — apply force to both i and j.
    //   For j's force: negate the direction; swap the rule-matrix indices.
    //   Integration stays in the same outer-i loop, unchanged.
    //   Delete this old O(n²) loop once the grid walk is working.

    if (this.pStart.length <= 120) {
      this.pStart.push(performance.now())
    }
    // --------- SINGLE FRONT WALK ---------
    /*  x, x, x,    x = ignored grid cells
    *   x, s, a,    s = current selected grid cell
    *   b, c, d     a..d = compare s with a..d
    *   Every step:
    *   1: start cellgrid 0, 0
    *   2: find a..d
    *   2: s*s check
    *   3: s*(abcd) check
    *   4: move s -> a, if doesn't exist done
    *   5: find new a..d positions
    *   6: repeat cellgrid.length times
    * 
    *   Complexity thought experiment:
    *   - cellgrid (x, y) sides length: (5, 5)
    *   - cellgrid.length = 5*5 grid = 25 = len
    *   - bucket discovery: len * a..d
    *                       25 * 4 = 100 
    *   - total bucket comparisons: self_bucket_checks + a..d_bucket_checks /// (with processWithinBucket (internal) and process2ParticleBuckets (a..d))
    *                               len + len /// (for every cell in grid, check self bucket against self bucket and a..d bucket)
    *                               25 + 25 = 50
    *   - 1 times a FOR (cellgrid.length) loop walk
    *   - - 4 times a cellgrid search (a..d) (cellgrid[i + 1], cellgrid[i - 1 + cellCols], cellgrid[i + cellCols], cellgrid[i + 1 + cellCols])
    *   - - - OR 1 times a [i + 1, i - 1 + cellCols, cellgrid[i + cellCols], cellgrid[i + 1 + cellCols]].map(index => cellGroup[index]).filter((cell): cell is number[] => Boolean(cell)).flat(1)
    *   
    *   - Operations approx: 50(compare 2 buckets) + 100(find_buckets)
    *             Therefore: walk algorithm = O(2(cell_count) + 4(cell_count))
    *                                       = O(6n) to find all necessary particle pairs interaction buckets (n = cell_count)
    */
    
    const keys = cellMap.keys()
    for (const i of keys) {
      let selfBucket = cellMap.get(i) ?? [];
      let othersBucket = [i + 1, i - 1 + cellCols, i + cellCols, i + 1 + cellCols]
                         .map(index => cellMap.get(index))
                         .filter((cell): cell is number[] => Boolean(cell))
                         .flat(1);
      processWithinBucket(selfBucket);
      process2ParticleBuckets(selfBucket, othersBucket);
    }


    // ------------ Z-WALK CODE ------------ 
    /*  a, b, c,    a..j = total 3x3 cell neighbourhood around centre cell
    *   e, f, g,(x) f = neighbourhood centre
    *   h, i, j     x = if exists on grid: is the next neighbourhood cell
    *     (y)       y = else is the next neighbourhood cell
    *   Every step:
    *   1: start cellgrid 0, 0
    *   2: find a..e + g..j
    *   3: f*f check
    *   4: f*(a..e + g..j) check
    *   5: g*g check
    *   6: g*(bcij) check
    *   7: i*i check
    *   8: i*(ehj) check
    *   9: j*j check
    *   10: e*b check
    *   11: move f -> x or y, if neither exist done
    *   12 find new a..j + g..j positions
    *   13: repeat cellgrid.length / 2 times
    *   
    *   Complexity thought experiment:
    *   - cellgrid (x, y) sides length: (5, 5)
    *   - ceil(cellCols/2) * ceil(cellRows/2) = 9 = iCount
    *   - cellgrid.length = 5*5 grid = 25 = len
    *   - bucket discovery: iCount * (a..e + g..j)
    *                       9 * 8 = 72
    *   - total bucket comparisons: self_bucket_checks + f(a..e + g..j)_bucket_checks + g(bcij)_bucket_checks + i(ehj)_bucket_checks + e(b)_bucket_checks
    *                               len + iCount * ((a..e + g..j) + (bcij) + (ehj) + (b))
    *                               25 + 9 * (8 + 4 + 3 + 1)
    *                               25 + 144 = 169
    *   - Operations approx: 169(compare 2 buckets) + 72(find_buckets)
    *             Therefore: walk algorithm = O((ceil(cellCols/2) * ceil(cellRows/2))(16) + ((ceil(cellCols/2) * ceil(cellRows/2))(8) + self_checks)
    *                                       = O(16(n / 4) + 8(n / 4) + n) = O(7n) IF cell grid is even and square, else is as above ^:
    *                                       = example = O(9.64n) for 5x5 odd square grid it's > 1.37*O
    *                                       = O(xn) where {7 <= x}
    *             Therefore: worse at best than single front walk
    *   
    */
    // for (let cols = 0; cols < cellCols; cols += 2) {
    //   for (let rows = 0; rows < cellRows; rows += 2) {
    //     // 5 step 3x3 Z walk pattern:
    //     // init cell: check all 8 adj + self
    //     const s1Check = [0,1,2,3,5,6,7,8];
    //     // col + 1: check the 2 up and 2 down + self
    //     const s2Check = [1,2,7,8];
    //     // row + 1: check 1 to right and all 3 behind + self
    //     const s3Check = [3,6,8];
    //     // col/row + 1: check self
    //     // const s4Check = []
    //     // col - 1 check row - 1
    //     const s5Check = [1];
    //     const cellGroup: Array<number[] | undefined> = [];
    //     // get 3x3 cells centred on current cell
    //     for (let yIndex = -1; yIndex < 2; yIndex++) {
    //       for (let xIndex = -1; xIndex < 2; xIndex++) {
    //         if (cols + xIndex < cellCols && rows + yIndex < cellRows){
    //           cellGroup.push(cellMap.get((cols + xIndex) + (rows + yIndex) * cellCols));
    //         } else {
    //           cellGroup.push(undefined);
    //         }
    //       }
    //     }

    //     for (let t = 0; t < 5; t++) {
    //       let cell: number[] = [];
    //       let checkCells: number[] = [];
    //       switch (t) {
    //         case 0:
    //           cell = cellGroup[4] ?? [];
    //           checkCells = s1Check.map(index => cellGroup[index])
    //                               .filter((cell): cell is number[] => Boolean(cell))
    //                               .flat(1)
    //           processWithinBucket(cell)

    //           break;
    //         case 1:
    //           cell = cellGroup[5] ?? [];
    //           checkCells = s2Check.map(index => cellGroup[index])
    //                               .filter((cell): cell is number[] => Boolean(cell))
    //                               .flat(1)
    //           processWithinBucket(cell)
    //           break;
    //         case 2:
    //           cell = cellGroup[7] ?? [];
    //           checkCells = s3Check.map(index => cellGroup[index])
    //                               .filter((cell): cell is number[] => Boolean(cell))
    //                               .flat(1)
    //           processWithinBucket(cell)
    //           break;
    //         case 3:
    //           cell = cellGroup[8] ?? [];
    //           checkCells = []
    //           processWithinBucket(cell)
    //           break;
    //         case 4:
    //           cell = cellGroup[3] ?? [];
    //           checkCells = s5Check.map(index => cellGroup[index])
    //                               .filter((cell): cell is number[] => Boolean(cell))
    //                               .flat(1)
    //           break;
    //       }
    //       process2ParticleBuckets(cell, checkCells)
    //     }
      
    //   }
    // }

    // --- PAIR LOOP PERFORMANCE METRICS ---
    // Goal is < 16ms pair check time at 10000 particles 3 types
    // Z-Walk: 10000 particles, 3 types, range 29~43ms: even distribution start ~ runtime particle concentration over time
    // Front-Walk: 10000 particles, 3 types, range 21~32ms: even distribution start ~ runtime particle concentration over time
    if (this.pEnd.length <= 120) {
      this.pEnd.push(performance.now())
    } else {
      if (this.pOutputTime) {
        console.log(1000 / (performance.now() - this.pOutputTime) + "outputs per second? Should be 0.5 at 60fps")
      }
      this.pOutputTime = performance.now()
      if (this.pStart.length === this.pEnd.length) {
        let pDiff: number[] = []
        for (let i = 0; i < this.pEnd.length; i++) {
          pDiff.push(this.pEnd[i] - this.pStart[i])
        }
        let pAvg = 0
        for (let i = 0; i < pDiff.length; i++) {
          pAvg += (pDiff[i] - pAvg) / (i + 1);
        }
        this.pTotalAverage.push(pAvg)
        console.log("Average frame time last 120 frames: " + pAvg + "ms")
        pAvg = 0
        for (let i = 0; i < this.pTotalAverage.length; i++) {
          pAvg += (this.pTotalAverage[i] - pAvg) / (i + 1);
        }
        console.log("Average of all 120 frame sets so far: " + pAvg + "ms")
      } else {
        console.warn("pStart and pEnd diverged!")
      }
      this.pStart = []
      this.pEnd = []
      
    }
    
    for (let i = 0; i < count; i++) {
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

    // --- old O(count²) loop ---
    // for (let i = 0; i < count; i++){
    //   for (let j = 0; j < count; j++) {
    //     if (i !== j) {
          
    //       // Compute vector direction
    //       const dx = posX[j] - posX[i];
    //       const dy = posY[j] - posY[i];
    //       // Zero magnitude guard
    //       if (dx === 0 && dy === 0) continue;
    //       // Too far away to matter
    //       if (dx*dx + dy*dy > rMax*rMax) continue;
    //       // Compute magnitude, named as distance
    //       const distance = Math.sqrt(dx ** 2 + dy ** 2);
    //       // Compute normalised vector
    //       const nx = dx / distance;
    //       const ny = dy / distance;
    //       // Affinity coefficient.
    //       const a: number = rules[type[i] * numTypes + type[j]]
    //       // Compute force
    //       const f = force(distance, a, rMax, beta);
    //       // Accumulate 
    //       accX[i] += f * nx * speed;
    //       accY[i] += f * ny * speed; 
    //     } // note to self: after M3 check if 2 particles with same pos, type and vel ever separate
    //   }
    //   // accumulate velocity
    //   velX[i] += accX[i] * dt;
    //   velY[i] += accY[i] * dt;
    //   // apply velocity to pos
    //   posX[i] += velX[i] * dt;
    //   posY[i] += velY[i] * dt;
    //   // bounce off edge
    //   if (posX[i] > width) {
    //     posX[i] = width;
    //     velX[i] *= -1
    //   } else if (posX[i] < 0) {
    //     posX[i] = 0
    //     velX[i] *= -1
    //   }
    //   if (posY[i] > height) {
    //     posY[i] = height;
    //     velY[i] *= -1
    //   } else if (posY[i] < 0) {
    //     posY[i] = 0
    //     velY[i] *= -1
    //   }
    //   velX[i] *= liveFriction;
    //   velY[i] *= liveFriction;
    // }

  }
}
