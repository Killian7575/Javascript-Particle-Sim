// import { force } from '../core/rules.ts';
import { mulberry32 } from '../core/seededrng.ts';
import { getBufferSpec, createPartitioner } from './spatialPartition/PartitionModules.ts';
import { clamp } from '../core/util.ts';

// SimProbe is a tiny interface defined in benchmark.ts.
// In production, app.ts passes nothing; in dev, it passes bench.probe
import type { SimProbe } from '../../test/benchmark/benchmark.ts';
const workerUrl = new URL('./workers/worker.js', import.meta.url)


export class ParticleSimulator {
  // --- SoA State ---
  // --- Interleaved = [x0, y0, x1, y1, x2, y2, ...]
  readonly posBuffers: [Float64Array<SharedArrayBuffer>, Float64Array<SharedArrayBuffer>]
  readonly velInterleaved: Float64Array<SharedArrayBuffer>;
  readonly type: Uint8Array<SharedArrayBuffer>;
  readonly typeRMax: Float64Array<SharedArrayBuffer>;
  readonly typeBeta: Float64Array<SharedArrayBuffer>;
  readonly rules: Float64Array<SharedArrayBuffer>;
  readonly liveParams: Float64Array<SharedArrayBuffer>;

  private requestedBuffers: Record<string, SharedArrayBuffer>;
  private spatialModuleName: SpatialModuleName;
  private spatialModule: SpatialPartitionClass;

  currentPositions: Float64Array<SharedArrayBuffer>;

  // --- Reused Force Accumulators ---
  private readonly accumInterleaved: Float64Array<SharedArrayBuffer>;

  // --- Seeded PRNG ---
  private readonly random: () => number;

  // --- Space Dimensions ---
  readonly dim = 2; // 2 = 2D

  // --- Workers + Controls ---
  private readonly workerPool: Worker[] = [];
  private readyCount = 0;
  private readonly readyPromise: Promise<void>;
  private readyResolve!: (value?: void | PromiseLike<void>) => void;
  private readonly MODES: WorkerBoundaryModes = { WRAP: 0, BOUNCE: 1, SNAP: 2 };
  private readonly CTRL: WorkerControls = { FRAME: 0, COUNTER: 1, STATUS: 2 };
  private readonly STATUS: WorkerStatus = { RUNNING: 0, COMPLETE: 1, TERMINATED: 2 };
  private readonly PARAMS: WorkerLiveParams = { DT: 0, SPEED: 1, FRICTION: 2, BOUNDARY: 3, MAXACCEL: 4 };
  private readonly POSIDX: WorkerReadWrite = { READ: 0, WRITE: 1 };
  private readonly controlSignal: Int32Array<SharedArrayBuffer>;
  private readonly posRW: Uint8Array<SharedArrayBuffer>;

  // --- counts + tunables ---
  readonly particleCount: number;
  readonly typeCount: number;
  speedLive = 0.1;         // universal force multiplier
  frictionLive = 0.05;     // Represents remaining velocity after 1 second of friction
  rMaxLive: number[];          // interaction radius (== future CELL_SIZE at M5)
  betaLive: number[];          // fraction of rMax that is pure repulsion
  maxAccelLive: number;
  readonly simWidth: number;       
  readonly simHeight: number;
  readonly spacing: number;
  rulesLive: number[];   // typeCount*typeCount, each in [-1, 1]
  boundaryModeLive: BoundaryMode = "BOUNCE"

  NEW_CHANGE: boolean = false;


  // --- Benchmarking Probe ---
  probe: SimProbe | undefined;

  constructor(config: Config, spatialModuleName: SpatialModuleName, injectedProbe?: SimProbe, cpuCorePercent: number = 0.75 ) {
    const { seed, particleCount, typeCount, simWidth, simHeight, spacing } = config
    console.info(`Particle count is: ${particleCount}`);
    this.random = mulberry32(seed)

    this.probe = injectedProbe;

    const bytesPerFloat64ArrayElement = Float64Array.BYTES_PER_ELEMENT;
    const bytesPerUInt8ArrayElement = Uint8Array.BYTES_PER_ELEMENT;

    this.particleCount = particleCount;
    this.typeCount = typeCount;
    this.simWidth = simWidth;
    this.simHeight = simHeight;
    this.spacing = spacing

    const posBuffer0 = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));
    const posBuffer1 = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));
    this.posBuffers = [posBuffer0, posBuffer1];
    this.velInterleaved = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));
    this.accumInterleaved = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * particleCount * this.dim));

    this.type = new Uint8Array(new SharedArrayBuffer(bytesPerUInt8ArrayElement * particleCount));
    this.typeRMax = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * typeCount));
    this.typeBeta = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * typeCount));
    this.rules = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * typeCount * typeCount));

    this.liveParams = new Float64Array(new SharedArrayBuffer(bytesPerFloat64ArrayElement * Object.keys(this.PARAMS).length))
    this.controlSignal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * Object.keys(this.CTRL).length))
    this.posRW = new Uint8Array(new SharedArrayBuffer(bytesPerUInt8ArrayElement * Object.keys(this.POSIDX).length));
    this.spatialModuleName = spatialModuleName;

    
    this.posRW[this.POSIDX.READ] = this.controlSignal[this.CTRL.FRAME] & 1;
    this.posRW[this.POSIDX.WRITE] = this.controlSignal[this.CTRL.FRAME] ^ 1;
    
    this.requestedBuffers = {};
    for (const { name, byteLength } of getBufferSpec(spatialModuleName, {
      spacing: spacing,
      particleCount: particleCount,
      world: {
        simWidth: simWidth,
        simHeight: simHeight,
      }
    })) {
      this.requestedBuffers[name] = new SharedArrayBuffer(byteLength)
    }
    this.spatialModule = createPartitioner(spatialModuleName, {
      simWidth: simWidth,
      simHeight: simHeight,
      particleCount: particleCount,
      dimension: this.dim,
      spacing: spacing,
      positions: this.posBuffers[this.posRW[this.POSIDX.READ]],
      requestedBuffers: this.requestedBuffers
    })

    this.speedLive = 0.1;
    this.frictionLive = 0.05;
    this.rMaxLive = Array(typeCount).fill(100);
    this.betaLive = Array(typeCount).fill(0.3);
    this.rulesLive = Array(typeCount * typeCount);
    this.maxAccelLive = 5;

    
    this.randomRules()
    
    this.initBufferParams()
    
    this.seed();
    this.currentPositions = this.posBuffers[this.posRW[this.POSIDX.WRITE]]
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve; 
    });
    this.initWorkerPool(clamp(Math.ceil(navigator.hardwareConcurrency * cpuCorePercent), 0, navigator.hardwareConcurrency));
  }

  private initBufferParams() {
    const { PARAMS, MODES } = this
    this.liveParams[PARAMS.SPEED] = this.speedLive;
    this.liveParams[PARAMS.BOUNDARY] = MODES[this.boundaryModeLive];
    this.typeRMax.set(this.rMaxLive);
    this.typeBeta.set(this.betaLive);
    this.rules.set(this.rulesLive);
  }
  randomRules() {
    const { random, typeCount } = this;
    let rulesArr: number[] = [];
    for (let i = 0; i < typeCount * typeCount; i++) {
      rulesArr.push((random() * 2) - 1)
    }
    this.rulesLive = rulesArr;
  }

  /** (Re)randomise positions and types in place; zero velocities. */
  seed() {
    const { 
      particleCount, random, simWidth, simHeight, dim, typeCount,
      posBuffers, velInterleaved, type
     } = this
     const pos = posBuffers[this.posRW[this.POSIDX.READ]];
    for (let i = 0, p = 0; i < particleCount * dim; i += dim, p++) {
      pos[i] = random() * simWidth;
      pos[i + 1] = random() * simHeight;
      type[p] = Math.floor(random() * typeCount);
      velInterleaved[i] = 0;
      velInterleaved[i + 1] = 0;
    }
    posBuffers[this.posRW[this.POSIDX.WRITE]].set(posBuffers[this.posRW[this.POSIDX.READ]])
  }

  private initWorkerPool(size: number): void {
    const { workerPool } = this
    const buffers = {
      posBuffers: this.posBuffers,
      posRW: this.posRW,
      velInterleaved: this.velInterleaved,
      accumInterleaved: this.accumInterleaved,
      type: this.type,
      rules: this.rules,
      typeRMax: this.typeRMax,
      typeBeta: this.typeBeta,
      liveParams: this.liveParams,
      requestedBuffers: this.requestedBuffers
    } as SimSharedBuffers
    const config = {
      workerInfo: {
        controlSignal: this.controlSignal,
        CTRL: this.CTRL,
      },
      simInfo: {
        particleCount: this.particleCount,
        typeCount: this.typeCount,
        simWidth: this.simWidth,
        simHeight: this.simHeight,
        dimension: this.dim,
        spacing: this.spacing,
        spatialModuleName: this.spatialModuleName,
        PARAMS: this.PARAMS,
        MODES: this.MODES,
        POSIDX: this.POSIDX,
      },
      buffers
    } as WorkerConfig

    for (let i = 0; i < size; i++) {
      config.workerInfo.workerId = i;
      config.workerInfo.workerSlice = this.calcWorkerSlice(i, size);
      const worker: Worker = new Worker(workerUrl, { type: "module" });
      worker.onmessage = (e) => {this.onWorkerMessage(e)};
      worker.onerror = (e) => { console.error(e) };
      worker.postMessage(config);

      workerPool.push(worker);
      console.log("WORKER PUSHED TO POOL")
    }
  }
  private calcWorkerSlice(workerId: number, workerCount: number): [number, number] {
    const { particleCount } = this
    const baseSlice = Math.ceil(particleCount / workerCount);
    const start = (baseSlice) * workerId
    const end = Math.min((baseSlice) * (workerId + 1), particleCount)
    return [start, end];
  }
  private onWorkerMessage(e: MessageEvent): void {
    if (Atomics.load(this.controlSignal, this.CTRL.STATUS) === this.STATUS.TERMINATED) return; // ignore stragglers from a torn-down sim
    if (e.data?.type === "ready") {
      this.readyCount++;
      console.info(`Worker ${e.data.workerId} ready! Allocated particles ${e.data.workerSlice[0]} to ${e.data.workerSlice[1]}`)
      if (this.readyCount === this.workerPool.length) {
        this.readyResolve();                   // all up — unblock ready()
      }
    }
  }
  ready(): Promise<void> {
    return this.readyPromise;
  }
  async terminate(): Promise<void> {
    Atomics.store(this.controlSignal, this.CTRL.STATUS, this.STATUS.TERMINATED);
    Atomics.store(this.controlSignal, this.CTRL.COUNTER, this.workerPool.length);
    let i = 0;
    for (const worker of this.workerPool) {
      worker.terminate()
      console.info(`Worker ${i} was terminated`)
      i++
    }
    Atomics.notify(this.controlSignal, this.CTRL.COUNTER);
  }

  /* 
   *  Advance the sim by `dt`, dt = ~1 each frame when running at 60fps. 
   *  probe — undefined in production, bench.probe in dev.
   */
  async update(dt: number): Promise<void> {
    const {
      speedLive, frictionLive, rMaxLive, betaLive, rulesLive, boundaryModeLive, maxAccelLive: maxAccelLive,
      typeRMax, typeBeta, rules,
      liveParams, controlSignal, posRW, 
      PARAMS, CTRL, MODES, STATUS, POSIDX,
      workerPool, probe,
      spatialModule
    } = this;
    // PRECOMPUTE
    probe?.startSpan("sim:update");

    
    probe?.startSpan("sim:update:updateParamBuffers");
    controlSignal[CTRL.COUNTER] = 0;
    posRW[POSIDX.READ] = controlSignal[CTRL.FRAME] & 1;
    posRW[POSIDX.WRITE] = posRW[POSIDX.READ] ^ 1;
    liveParams[PARAMS.DT] = dt;
    liveParams[PARAMS.FRICTION] = Math.pow(frictionLive, dt / 60);
    if (this.NEW_CHANGE) {
      liveParams[PARAMS.SPEED] = speedLive;
      liveParams[PARAMS.BOUNDARY] = MODES[boundaryModeLive];
      liveParams[PARAMS.MAXACCEL] = maxAccelLive;
      typeRMax.set(rMaxLive);
      typeBeta.set(betaLive);
      rules.set(rulesLive);
      this.NEW_CHANGE = false;
    }
    spatialModule.positions = this.posBuffers[posRW[POSIDX.READ]]
    spatialModule.bin();
    probe?.endSpan("sim:update:updateParamBuffers");


    // INITIATE WORKERS
    probe?.startSpan("sim:update:workers");
    Atomics.store(controlSignal, CTRL.STATUS, STATUS.RUNNING)
    Atomics.add(controlSignal, CTRL.FRAME, 1);
    Atomics.notify(controlSignal, CTRL.FRAME);
  
    
    // WAIT TILL ALL WORKERS COMPLETE
    let finishedWorkers = Atomics.load(controlSignal, CTRL.COUNTER);
    while (finishedWorkers < workerPool.length) {
      const res = Atomics.waitAsync(controlSignal, CTRL.COUNTER, finishedWorkers);
      if (res.async) await res.value;
      finishedWorkers = Atomics.load(controlSignal, CTRL.COUNTER);
    }
    
    probe?.endSpan("sim:update:workers");

    // UPDATE PARTICLE POSITIONS
    probe?.startSpan("sim:update:referenceCurrentPos");
    this.currentPositions = this.posBuffers[posRW[POSIDX.WRITE]];
    this.accumInterleaved.fill(0);
    probe?.endSpan("sim:update:referenceCurrentPos")

    probe?.endSpan("sim:update");
    probe?.commitFrame();
  }
}
