import { force } from '../core/rules.ts';
import { mulberry32 } from '../core/seededrng.ts';
const BENCH_ENABLED = import.meta.env.DEV;

import { accumCross, accumWithin, accumCells, resetAccumulators, addAccumCross, addAccumWithin, incAccumCells } from '../../test/benchmark/benchmark.ts';

export class ParticleSimulator {
  // --- SoA state: particle i is (posX[i], posY[i], velX[i], velY[i], type[i]) ---
  readonly posX: Float64Array;
  readonly posY: Float64Array;
  readonly velX: Float64Array;
  readonly velY: Float64Array;
  readonly type: Uint8Array;

  // --- reused force accumulators ---
  private readonly accumX: Float64Array;
  private readonly accumY: Float64Array;

  private cellMap: Map<number, number[]> = new Map();
  private cellCols = 0;
  private cellRows = 0;

  // --- Seeded PRNG ---
  private readonly random: () => number;

  // --- counts + tunables (lil-gui binds straight to these fields at M6) ---
  particleCount: number;
  typeCount: number;
  speed = 0.1;         // universal force multiplier
  rMax = 100;          // interaction radius (== future CELL_SIZE at M5)
  beta = 0.3;          // fraction of rMax that is pure repulsion
  friction = 0.05;     // Represents remaining velocity after 1 second of friction
  simWidth: number;       
  simHeight: number;

  rules: Float64Array;   // numTypes*numTypes, each in [-1, 1]

  constructor(config: Config) {
    const { seed, particleCount, typeCount, simWidth, simHeight } = config
    this.random = mulberry32(seed)

    this.particleCount = particleCount;
    this.typeCount = typeCount;
    this.simWidth = simWidth;
    this.simHeight = simHeight;

    this.posX = new Float64Array(particleCount);
    this.posY = new Float64Array(particleCount);
    this.velX = new Float64Array(particleCount);
    this.velY = new Float64Array(particleCount);
    this.type = new Uint8Array(particleCount);

    this.accumX = new Float64Array(particleCount);
    this.accumY = new Float64Array(particleCount);

    this.rules = new Float64Array(typeCount * typeCount);
    this.initRules();
    this.seed();
  }

  initRules() {
    /* Cool rule sets:    
       OG rule set:
    1. [-0.05, 1, 1, 1, 0.75, 1, -0.5, -0.5, -0.5]
    */
    this.rules = new Float64Array([ -0.7824554443359375, -0.5159652233123779, -0.7399479150772095, 0.7869302034378052, -0.7077521681785583, 0.7734294533729553, -0.9772785305976868, 0.8419510126113892, -0.7135220766067505 ])
    // console.log(this.rules) // a way to save cool rulesets
  }

  /** (Re)randomise positions and types in place; zero velocities. */
  seed() {
    for (let i = 0; i < this.particleCount; i++) {
      this.posX[i] = this.random() * this.simWidth;
      this.posY[i] = this.random() * this.simHeight;
      this.type[i] = Math.floor(this.random() * this.typeCount);

      this.velX[i] = 0;
      this.velY[i] = 0;
    }

  }

  private buildGrid(): void {
    const { posX, posY, particleCount: count, rMax, simWidth: width, simHeight: height } = this;
    let { cellMap } = this;

    this.cellCols = Math.ceil(width / rMax);
    this.cellRows = Math.ceil(height / rMax);

    cellMap.clear();

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

  /** Advance the sim by `dt`, dt = ~1 each frame when running at 60fps. */
  update(dt: number) {
    const frameStart = BENCH_ENABLED ? performance.now() : 0;


    const { posX, posY, velX, velY, accumX: accX, accumY: accY, particleCount: count, type, rMax, beta, simWidth: width, simHeight: height, friction, rules, typeCount: numTypes, speed } = this;

    const buildGridStart = BENCH_ENABLED ? performance.now() : 0;
    this.buildGrid();
    if (BENCH_ENABLED) performance.measure('sim:buildGrid', { start: buildGridStart })

    const { cellMap, cellCols, cellRows } = this;

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

    // Process all interaction between 2 groups
    function process2ParticleBuckets(b1: number[], b2: number[]) {
      if (b2.length > 0 && b1.length > 0)  {
        for (let i = 0; i < b1.length; i++){
          for (let j = 0; j < b2.length; j++) {
            processPair(b1[i], b2[j])
          }
        }
      }
    }

    // Process all interactions within a group
    function processWithinBucket(b: number[]) {
      for (let i = 0; i < b.length; i++){
        for (let j = 0; j < b.length; j++) {
          if (j > i) {
            processPair(b[i], b[j])
          }
        }
      }
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
    */
    const walkStart = BENCH_ENABLED ? performance.now() : 0;
    const keys = cellMap.keys()
    for (const i of keys) {
      let selfBucket = cellMap.get(i) ?? [];
      let othersBucket = [i + 1, i - 1 + cellCols, i + cellCols, i + 1 + cellCols]
                         .map(index => cellMap.get(index))
                         .filter((cell): cell is number[] => Boolean(cell))
                         .flat(1);

      const t0 = BENCH_ENABLED ? performance.now() : 0;
      processWithinBucket(selfBucket);
      if (BENCH_ENABLED) addAccumWithin(performance.now() - t0);

      const t1 = BENCH_ENABLED ? performance.now() : 0;
      process2ParticleBuckets(selfBucket, othersBucket);
      if (BENCH_ENABLED) addAccumCross(performance.now() - t1);

      if (BENCH_ENABLED) incAccumCells;
    }
    if (BENCH_ENABLED) performance.measure('sim:walk', { start: walkStart })

    // Apply forces to particles. Then apply boundary logic, then apply friction
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
    if (BENCH_ENABLED) {
      performance.measure('sim:within',    { duration: accumWithin });
      performance.measure('sim:cross',     { duration: accumCross });
      performance.measure('sim:cellCount', { duration: accumCells });
      performance.measure('sim:frame',     { start: frameStart });
      resetAccumulators();
    }

  }
}
