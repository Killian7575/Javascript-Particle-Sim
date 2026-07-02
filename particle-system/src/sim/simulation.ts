import { force } from '../core/rules.ts';
import { mulberry32 } from '../core/seededrng.ts';

// SimProbe is a tiny interface defined in benchmark.ts.
// In production, app.ts passes nothing; in dev, it passes bench.probe
import type { SimProbe } from '../../test/benchmark/benchmark.ts';


export class ParticleSimulator {
  // --- SoA state ---
  // --- Interleaved = [x0, y0, x1, y1, x2, y2, ...]
  readonly posInterleaved: Float64Array<SharedArrayBuffer>;
  readonly velInterleaved: Float64Array<SharedArrayBuffer>;
  readonly type: Uint8Array<SharedArrayBuffer>;

  // --- reused force accumulators ---
  private readonly accumInterleaved: Float64Array<SharedArrayBuffer>;

  private cellMap: Map<number, number[]> = new Map();
  private cellCols = 0;

  // --- Seeded PRNG ---
  private readonly random: () => number;

  // --- Space Dimensions ---
  readonly dim = 2; // 2 = 2D

  // --- counts + tunables (lil-gui binds straight to these fields at M6) ---
  particleCount: number;
  typeCount: number;
  speed = 0.1;         // universal force multiplier
  rMax = 100;          // interaction radius (== future CELL_SIZE at M5)
  beta = 0.3;          // fraction of rMax that is pure repulsion
  friction = 0.05;     // Represents remaining velocity after 1 second of friction
  simWidth: number;       
  simHeight: number;
  rules: Float64Array<SharedArrayBuffer>;   // typeCount*typeCount, each in [-1, 1]

  // --- Benchmarking Probe ---
  probe: SimProbe | undefined;

  constructor(config: Config, injectedProbe?: SimProbe ) {
    
    const { seed, particleCount, typeCount, simWidth, simHeight } = config
    this.random = mulberry32(seed)

    this.probe = injectedProbe;

    const bytesPerFloat64ArrayElement = Float64Array.BYTES_PER_ELEMENT;
    const bytesPerUInt8ArrayElement = Uint8Array.BYTES_PER_ELEMENT;

    this.particleCount = particleCount;
    this.typeCount = typeCount;
    this.simWidth = simWidth;
    this.simHeight = simHeight;

    this.posInterleaved = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));
    this.velInterleaved = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));
    this.accumInterleaved = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));

    // this.posX = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount));
    // this.posY = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount));
    // this.velX = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount));
    // this.velY = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount));
    this.type = new Uint8Array(new SharedArrayBuffer(bytesPerUInt8ArrayElement * particleCount));

    // this.accumX = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount));
    // this.accumY = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount));

    this.rules = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * typeCount * typeCount));
    this.initRules();
    console.log("About to seed")
    this.seed();
  }

  initRules() {
    /* Cool rule sets:    
       OG rule set:
    1. [-0.05, 1, 1, 1, 0.75, 1, -0.5, -0.5, -0.5]
    */
    const defaultRules = [
      -0.7824554443359375, -0.5159652233123779, -0.7399479150772095,
       0.7869302034378052, -0.7077521681785583,  0.7734294533729553,
      -0.9772785305976868,  0.8419510126113892, -0.7135220766067505 
    ]
    console.assert(defaultRules.length === this.rules.length && this.typeCount === 3)
    this.rules.set(defaultRules);
  }

  /** (Re)randomise positions and types in place; zero velocities. */
  seed() {
    const { 
      particleCount, random, simWidth, simHeight, dim, typeCount,
      posInterleaved, velInterleaved, type
     } = this
    console.log(particleCount)
    for (let i = 0, p = 0; i < particleCount * dim; i += dim, p++) {
      posInterleaved[i] = random() * simWidth;
      posInterleaved[i + 1] = random() * simHeight;
      type[p] = Math.floor(random() * typeCount);
      velInterleaved[i] = 0;
      velInterleaved[i + 1] = 0;
    }
  }

  private buildGrid(): void {
    const { posInterleaved, particleCount, rMax, simWidth, dim } = this

    this.cellCols = Math.ceil(simWidth / rMax);

    this.cellMap.clear();

    for (let i = 0; i < particleCount * dim; i += dim){
      const cx = Math.floor(posInterleaved[i] / rMax);
      const cy = Math.floor(posInterleaved[i + 1] / rMax);
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
      posInterleaved, velInterleaved, accumInterleaved, type,
      particleCount, typeCount, dim,
      rMax, beta, friction, rules, speed,
      simWidth, simHeight,
      probe
    } = this;
    probe?.startSpan("sim:update")

    probe?.startSpan("sim:update:buildGrid");
    this.buildGrid();
    probe?.endSpan("sim:update:buildGrid")

    const { cellMap, cellCols } = this;

    accumInterleaved.fill(0);

    const liveFriction = Math.pow(friction, dt / 60);

    function processPair(pi: number, pj: number): void {
      // const dx = posX[pj] - posX[pi];
      // const dy = posY[pj] - posY[pi];
      const dx = posInterleaved[pj] - posInterleaved[pi];
      const dy = posInterleaved[pj + 1] - posInterleaved[pi + 1]

      const ti = pi / dim;  // particle index for pi
      const tj = pj / dim;  // particle index for pj
      
      // Affinity coefficient.
      const a: number = rules[type[ti] * typeCount + type[tj]];
      // Zero coefficient guard
      if (a === 0) return;
      // Zero magnitude guard
      if (dx === 0 && dy === 0) return;
      // Distance Guard
      if (dx * dx + dy * dy > rMax * rMax) return;
      // Compute magnitude, named as distance
      const distance = Math.sqrt(dx ** 2 + dy ** 2);
      // Compute normalised vector
      const nx = dx / distance;
      const ny = dy / distance;
      // Compute force
      const f = force(distance, a, rMax, beta);
      // Accumulate 
      accumInterleaved[pi] += f * nx * speed;
      accumInterleaved[pi + 1] += f * ny * speed; 

      // Again but j affected by i
      const a2: number = rules[type[tj] * typeCount + type[ti]]
      const f2 = force(distance, a2, rMax, beta);
      // Accumulate 
      accumInterleaved[pj] += f2 * -nx * speed;
      accumInterleaved[pj + 1] += f2 * -ny * speed;
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
    function borderRule(i: number, method: "WRAP" | "BOUNCE" | "SNAP" = "BOUNCE") {
      switch (method) {
        case "BOUNCE": {
          if (posInterleaved[i] > simWidth) {
            posInterleaved[i] = simWidth;
            velInterleaved[i] *= -1
          } else if (posInterleaved[i] < 0) {
            posInterleaved[i] = 0
            velInterleaved[i] *= -1
          }
          if (posInterleaved[i + 1] > simHeight) {
            posInterleaved[i + 1] = simHeight;
            velInterleaved[i + 1] *= -1
          } else if (posInterleaved[i + 1] < 0) {
            posInterleaved[i + 1] = 0
            velInterleaved[i + 1] *= -1
          }
          break;
        }
        case "SNAP":{
          if (posInterleaved[i] > simWidth) {
            posInterleaved[i] = simWidth;
          } else if (posInterleaved[i] < 0) {
            posInterleaved[i] = 0
          }
          if (posInterleaved[i + 1] > simHeight) {
            posInterleaved[i + 1] = simHeight;
          } else if (posInterleaved[i + 1] < 0) {
            posInterleaved[i + 1] = 0
          }
          break;
        }
        case "WRAP": {
          if (posInterleaved[i] > simWidth) {
            posInterleaved[i] -= simWidth;
          } else if (posInterleaved[i] < 0) {
            posInterleaved[i] += simWidth
          }
          if (posInterleaved[i + 1] > simHeight) {
            posInterleaved[i + 1] -= simHeight;
          } else if (posInterleaved[i + 1] < 0) {
            posInterleaved[i + 1] += simHeight
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
    for (let i = 0; i < particleCount * dim; i += dim) {
      // accumulate velocity
      velInterleaved[i] += accumInterleaved[i] * dt;
      velInterleaved[i + 1] += accumInterleaved[i + 1] * dt;
      // apply velocity to pos
      posInterleaved[i] += velInterleaved[i] * dt;
      posInterleaved[i + 1] += velInterleaved[i + 1] * dt;
      // World edge handling
      borderRule(i)

      velInterleaved[i] *= liveFriction;
      velInterleaved[i + 1] *= liveFriction;
    }
    probe?.endSpan("sim:update:integrate");
    probe?.endSpan("sim:update");
    probe?.commitFrame();
  }
}
