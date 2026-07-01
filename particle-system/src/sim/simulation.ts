import { force } from '../core/rules.ts';
import { mulberry32 } from '../core/seededrng.ts';

// SimProbe is a tiny interface defined in benchmark.ts.
// In production, app.ts passes nothing; in dev, it passes bench.probe
import type { SimProbe } from '../../test/benchmark/benchmark.ts';


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

  // --- Benchmarking Probe ---
  probe: SimProbe | undefined;

  constructor(config: Config, injectedProbe?: SimProbe ) {
    const { seed, particleCount, typeCount, simWidth, simHeight } = config
    this.random = mulberry32(seed)

    this.probe = injectedProbe;

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
    this.rules = new Float64Array([
      -0.7824554443359375, -0.5159652233123779, -0.7399479150772095,
       0.7869302034378052, -0.7077521681785583,  0.7734294533729553,
      -0.9772785305976868,  0.8419510126113892, -0.7135220766067505 
    ]);
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
    const { posX, posY, particleCount, rMax, simWidth } = this;

    this.cellCols = Math.ceil(simWidth / rMax);

    this.cellMap.clear();

    for (let i = 0; i < particleCount; i++){
      const cx = Math.floor(posX[i] / rMax);
      const cy = Math.floor(posY[i] / rMax);
      const cellIndex = cx + cy * this.cellCols;
      const cell = this.cellMap.get(cellIndex)
      if (cell) { cell.push(i) } else { this.cellMap.set(cellIndex, [i]) }
    }
  }

  /* 
   *  Advance the sim by `dt`, dt = ~1 each frame when running at 60fps. 
   *  probe — pass NullProbe in production, bench.probe in dev.
   */
  update(dt: number): void {
    
    const { 
      posX, posY, velX, velY, type,
      accumX, accumY, 
      particleCount, typeCount,
      rMax, beta, friction, rules, speed,
      simWidth, simHeight,
      probe
    } = this;
    probe?.startSpan("sim:update")

    probe?.startSpan("sim:update:buildGrid");
    this.buildGrid();
    probe?.endSpan("sim:update:buildGrid")

    const { cellMap, cellCols } = this;

    accumX.fill(0);
    accumY.fill(0);

    const liveFriction = Math.pow(friction, dt / 60);

    function processPair(pi: number, pj: number): void {
      const dx = posX[pj] - posX[pi];
      const dy = posY[pj] - posY[pi];
      // Zero magnitude guard
      if (dx === 0 && dy === 0) return;
      // Too far away to matter
      if (dx * dx + dy * dy > rMax * rMax) return;
      // Compute magnitude, named as distance
      const distance = Math.sqrt(dx ** 2 + dy ** 2);
      // Compute normalised vector
      const nx = dx / distance;
      const ny = dy / distance;
      // Affinity coefficient.
      const a: number = rules[type[pi] * typeCount + type[pj]]
      // Compute force
      const f = force(distance, a, rMax, beta);
      // Accumulate 
      accumX[pi] += f * nx * speed;
      accumY[pi] += f * ny * speed; 

      // Again but j affected by i
      const a2: number = rules[type[pj] * typeCount + type[pi]]
      const f2 = force(distance, a2, rMax, beta);
      // Accumulate 
      accumX[pj] += f2 * -nx * speed;
      accumY[pj] += f2 * -ny * speed;
    }

    // Process all interaction between 2 groups
    function process2ParticleBuckets(b1: number[], b2: number[]): void {
      if (b2.length > 0 && b1.length > 0)  {
        for (let i = 0; i < b1.length; i++){
          for (let j = 0; j < b2.length; j++) {
            processPair(b1[i], b2[j])
          }
        }
      }
    }

    // Process all interactions within a group
    function processWithinBucket(b: number[]): void {
      for (let i = 0; i < b.length; i++){
        for (let j = 0; j < b.length; j++) {
          if (j > i) {
            processPair(b[i], b[j])
          }
        }
      }
    }
    function borderRule(i: number, method: "wrap" | "bounce" = "wrap") {
      switch (method) {
        case "bounce": {
          if (posX[i] > simWidth) {
            posX[i] = simWidth;
            velX[i] *= -1
          } else if (posX[i] < 0) {
            posX[i] = 0
            velX[i] *= -1
          }
          if (posY[i] > simHeight) {
            posY[i] = simHeight;
            velY[i] *= -1
          } else if (posY[i] < 0) {
            posY[i] = 0
            velY[i] *= -1
          }
          break;
        }
        case "wrap": {
          if (posX[i] > simWidth) {
            posX[i] -= simWidth;
          } else if (posX[i] < 0) {
            posX[i] += simWidth;
          }
          if (posY[i] > simHeight) {
            posY[i] -= simHeight;
          } else if (posY[i] < 0) {
            posY[i] += simHeight;
          }
          break;
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
    probe?.startSpan("sim:update:walk");
    const keys = cellMap.keys()
    for (const i of keys) {
      let selfBucket = cellMap.get(i) ?? [];
      let othersBucket = [i + 1, i - 1 + cellCols, i + cellCols, i + 1 + cellCols]
                         .flatMap(idx => cellMap.get(idx) ?? []);

      probe?.startSpan("sim:update:walk:within");
      processWithinBucket(selfBucket);
      probe?.endSpan("sim:update:walk:within");

      probe?.startSpan("sim:update:walk:cross");
      process2ParticleBuckets(selfBucket, othersBucket);
      probe?.endSpan("sim:update:walk:cross");

      probe?.accumCount("sim:update:walk:cellsVisited", 1);
    }
    probe?.endSpan("sim:update:walk");

    probe?.startSpan("sim:update:integrate")
    // Apply forces to particles. Then apply boundary logic, then apply friction
    for (let i = 0; i < particleCount; i++) {
      // accumulate velocity
      velX[i] += accumX[i] * dt;
      velY[i] += accumY[i] * dt;
      // apply velocity to pos
      posX[i] += velX[i] * dt;
      posY[i] += velY[i] * dt;
      // World edge handling
      borderRule(i, "wrap")

      velX[i] *= liveFriction;
      velY[i] *= liveFriction;
    }
    probe?.endSpan("sim:update:integrate");
    probe?.endSpan("sim:update");
    probe?.commitFrame();
  }
}
