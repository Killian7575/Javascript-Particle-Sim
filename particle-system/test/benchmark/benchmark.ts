const BENCH_ENABLED = import.meta.env.DEV;
declare const __GIT_HASH__: string;

interface Pool {
  buf: Float64Array;
  head: number;
  count: number;
}
interface ConsoleOutput {
  avg: number;
  min: number;
  max: number;
  p95: number;
  n: number;
}
interface ComponentMetrics {
  avg: number;
  p95: number;
}
interface SingleRun {
  frames: Float64Array;
  componentAverages: Record<string, ComponentMetrics>;
}
interface Config {
  particleCount: number;
  typeCount: number;
  simWidth: number;
  simHeight: number;
}
interface Benchmark {
  frames: number;
  runs: number;
  warmup: number;
  config: Config; // new Simulation(config) <- thats the config
  currentRun: number;
  currentFrame: number;
  allRuns: SingleRun[];
  frameTimings: Float64Array; // per-frame sim:frame for current run
  componentAvg: Record<string, ComponentMetrics>; // sum of component avgs across frames 
}
interface BenchmarkRecord {
  meta: {
    timestamp: Date;
    git: string;
    config: Config;
    runCount: number;
    framesPerRun: number;
  },
  runs: SingleRun[];
  summary: {
    frameAvg: number;
    frameP95: number;
    frameMax: number;
    warmupFrames: number;
    postWarmupAvg: number;
  }
}

/* --- OUTPUT EXAMPLE ---
{
  "meta": {
    "timestamp": "2024-01-15T14:32:00Z",
    "git": "a3f9c12",
    "config": { "particleCount": 500, "cellCols": 20 },
    "runCount": 3,
    "framesPerRun": 600
  },
  "runs": [
    {
      "frames": [1.2, 1.4, 1.3, 2.1, ...],  // sim:frame per frame, ms
      "componentAvgs": {
        "sim:buildGrid": { "avg": 0.12, "p95": 0.18 },
        "sim:within":    { "avg": 0.84, "p95": 1.21 },
        "sim:cross":     { "avg": 0.61, "p95": 0.94 },
        "sim:cellCount": { "avg": 312 }
      }
    }
  ],
  "summary": {
    "frameAvg":    1.81,
    "frameP95":    3.12,
    "frameMax":    4.40,
    "warmupFrames": 60,   // excluded from summary stats
    "postWarmupAvg": 1.94
  }
}
*/

export class BenchmarkingTool {
  private _pools: Map<string, Pool> = new Map();
  private _poolSize: number = 120;
  private _obs: PerformanceObserver | undefined = undefined;
  private _bm: Benchmark | undefined;

  constructor(poolSize = 120) {  // 120 = 2s at 60fps
    this._pools = new Map();
    this._poolSize = poolSize;
    this._bm = undefined;
    if (BENCH_ENABLED) this.initObserver();
  }

  private initObserver() {
    this._obs = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        this.push(entry.name, entry.duration);
      }
    });
    this._obs.observe({ type: 'measure', buffered: false });
  }

  private push(name: string, value: number) {
    let pool = this._pools.get(name);
    if (!pool) {
      pool = {
        buf: new Float64Array(this._poolSize),
        head: 0,
        count: 0
      }
      //pool = { buf: new Float64Array(this._poolSize), head: 0, count: 0 };
      this._pools.set(name, pool);
    }
    pool.buf[pool.head] = value;
    pool.head = (pool.head + 1) % this._poolSize;
    if (pool.count < this._poolSize) pool.count++;
  }

  private save(data: BenchmarkRecord) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `bench_${data.meta.git}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.table(data.summary);  // also print the summary
  }

  private benchmarkOneSim() {
    // not yet implemented
  }

  startBenchmarkRun({frames = 600, runs = 3, warmup = 60, config = { particleCount: 10000, typeCount: 3, simWidth: 2000, simHeight: 2000 }}: 
                    {frames?: number; runs?: number; warmup?: number; config?: Config;} = {}) {
    if (!BENCH_ENABLED) return;
    this._bm = {
      frames, runs, warmup, config,
      currentRun: 0,
      currentFrame: 0,
      allRuns: [],
      frameTimings: new Float64Array(frames),       // per-frame sim:frame for current run
      componentAvg: {}      // sum of component avgs across frames
    };
    for (let i = 0; i < runs; i++) {
      this.benchmarkOneSim
    }
  }
  report() {
    if (!BENCH_ENABLED) return;
    const out: Record<string, ConsoleOutput> = {};
    for (const [name, pool] of this._pools) {
      const slice = pool.buf.subarray(0, pool.count);
      const avg = slice.reduce((a, b) => a + b, 0) / pool.count;
      const sorted = slice.slice().sort();
      out[name] = {
        avg:  +avg.toFixed(3),
        min:  +sorted[0].toFixed(3),
        max:  +sorted[pool.count - 1].toFixed(3),
        p95:  +sorted[Math.floor(pool.count * 0.95)].toFixed(3),
        n:    pool.count
      };
    }
    console.table(out);
  }

  reset(name: string) {
    if (name) this._pools.delete(name);
    else      this._pools.clear();
  }
}

// Accumulators — module-level so sim.js can import them directly
// In production these are dead code (ENABLED = false, all uses stripped)
export let accumWithin = 0;
export let accumCross  = 0;
export let accumCells  = 0;

export function resetAccumulators() {
  accumWithin = 0;
  accumCross  = 0;
  accumCells  = 0;
}

export const bench = BENCH_ENABLED ? new BenchmarkingTool() : null;
export { BENCH_ENABLED as BENCH_ENABLED };