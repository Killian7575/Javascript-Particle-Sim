import type { ParticleSimulator } from '../../src/sim/simulation';

const BENCH_ENABLED = import.meta.env.DEV;
declare const __GIT_HASH__: string;

// ---------------------------------------------------------------------------
// SimProbe — the ONLY interface simulation.ts needs to know about.
// The sim calls these methods; benchmark.ts provides the real impl;
// a no-op NullProbe is used in production so the sim imports nothing from here.
// ---------------------------------------------------------------------------

export interface SimProbe {
  /**
   * Start timing a named span
   * @param name The identifier string of the span
   * Usage:
   *   probe.startSpan('sim:update');
   *   doWork();
   *   probe.endSpan('sim:update');
   */
  startSpan(name: string): void;
  /**
   * End timing a named span
   * @param name The identifier string of the span
   * Usage:
   *   probe.startSpan('sim:update');
   *   doWork();
   *   probe.endSpan('sim:update');
   */
  endSpan(name: string): void;

  /**
   * Accumulate a duration manually
   * @param name The identifier string
   * @param ms Duration in ms of span
   */
  accumDuration(name: string, ms: number): void;

  /**
   * Accumulate context value: a plain number with no timing semantics.
   * @param name The identifier string
   * @param increment A number increment for value
   * Usage:
   *  for (...) { probe.accumCount("cellsVisited", 1) }
   *  OR
   *  probe.accumCount("cellVisited", cellMap.size)
   */
  accumCount(name: string, increment: number): void;

  /**
   * Commit frame accumulators
   * Usage:
   *  // After last probe use
   *  probe.commitFrame()
   */
  commitFrame(): void
}

// ---------------------------------------------------------------------------
// Internal storage types
// ---------------------------------------------------------------------------

interface ComponentMetrics {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

interface SingleRun {
  /** Raw per-frame totals (ms), indexed by frame number. */
  frames: number[];
  /** Per-component timing metrics, keyed by span name. */
  componentTimings: Record<string, ComponentMetrics>;
  /** Per-component context values (counts etc.), keyed by name. */
  componentCounts: Record<string, ComponentMetrics>;
}

interface BenchmarkRecord {
  meta: {
    timestamp: string;
    git: string;
    config: FullConfig;
    runCount: number;
    framesPerRun: number;
    warmupFrames: number;
  };
  runs: SingleRun[];
  summary: {
    allFrames: ComponentMetrics;
    postWarmupFrames: ComponentMetrics;
  };
}

/*
  NAMING CONVENTION
  'system:each:component:level' — e.g. 'sim:update' 'sim:update:buildGrid', 'sim:update:walk:within', 'sim:update:walk:cross'
  Counts follow the same convention: 'sim:update:walk:cellsVisited'
*/

// ---------------------------------------------------------------------------
// LiveProbe — the real SimProbe used during a benchmark run
// ---------------------------------------------------------------------------

class LiveProbe implements SimProbe {
  // span start times, keyed by the name passed to startSpan)
  private spans: Map<string, number> = new Map();
  private accumulateSpans: Map<string, number> = new Map();
  private accumulateCounts: Map<string, number> = new Map();

  // accumulated data per name
  timings: Map<string, number[]> = new Map();
  counts:  Map<string, number[]> = new Map();

  reset() {
    this.spans.clear();
    this.accumulateSpans.clear();
    this.accumulateCounts.clear();
    this.timings.clear();
    this.counts.clear();
  }

  startSpan(name: string): void {
    const t0 = performance.now();
    this.spans.set(name, t0);
  }

  endSpan(name: string): void {
    const t0 = this.spans.get(name);
    if (!t0) return;
    this.accumDuration(name, performance.now() - t0);
    this.spans.delete(name);
  }

  accumDuration(name: string, ms: number): void {
    let sum = this.accumulateSpans.get(name);
    if (!sum) { sum = 0 }
    sum += ms;
    this.accumulateSpans.set(name, sum);
  }

  accumCount(name: string, increment: number): void {
    let sum = this.accumulateCounts.get(name);
    if (!sum) { sum = 0 }
    sum += increment;
    this.accumulateCounts.set(name, sum);
  }

  commitFrame(): void {
    this.accumulateSpans.forEach((value, key) => {
      let arr = this.timings.get(key);
      if (!arr) { arr = []; this.timings.set(key, arr); }
      arr.push(value);
    });
    this.accumulateCounts.forEach((value, key) => {
      let arr = this.counts.get(key);
      if (!arr) { arr = []; this.counts.set(key, arr); }
      arr.push(value);
    });
    this.accumulateSpans.clear();
    this.accumulateCounts.clear();
  }
}

// ---------------------------------------------------------------------------
// BenchmarkingTool
// ---------------------------------------------------------------------------

export class BenchmarkingTool {
  private probe = new LiveProbe();

  benchmarkRun(
    frames:  number,
    runs:    number,
    warmup:  number,
    fullConfig: FullConfig,
    createSim: (cfg: FullConfig, probe: SimProbe) => ParticleSimulator,
  ): void {
    if (!BENCH_ENABLED) return;
    const allRuns: SingleRun[] = [];

    for (let r = 0; r < runs; r++) {
      this.probe.reset();
      const sim = createSim(fullConfig, this.probe);

      for (let f = 0; f < frames; f++) {
        sim.update(1);  // fixed dt=1 for reproducibility
      }

      allRuns.push(this.buildSingleRun());
    }

    console.assert(allRuns.length === runs, 'Run count mismatch');

    const record = this.buildRecord(frames, runs, warmup, fullConfig, allRuns);
    this.save(record);
    console.table(record.summary);
  }

  private buildSingleRun(): SingleRun {
    const timings: Record<string, ComponentMetrics> = {};
    const counts:  Record<string, ComponentMetrics> = {};
    let   frames:  number[] = [];

    const rootKey = this.findRootKey(this.probe.timings)
    console.info("rootKey: " + rootKey)

    for (const [name, values] of this.probe.timings) {
      const metrics = this.metrics(values);
      if (name === rootKey) {
        frames = values;
      } else {
        timings[name] = metrics;
      }
    }
    for (const [name, values] of this.probe.counts) {
      counts[name] = this.metrics(values);
    }

    return { frames, componentTimings: timings, componentCounts: counts };
  }

  private findRootKey(map: Map<string, any>): string {
    const countColons = (s: string) => (s.match(/:/g) ?? []).length;
    const arr = Array.from(map.keys());
    return arr.reduce((a, b) => countColons(a) <= countColons(b) ? a : b);
  }

  private buildRecord(
    frames: number,
    runs: number,
    warmup: number,
    config: FullConfig,
    allRuns: SingleRun[],
  ): BenchmarkRecord {
    const allFrameValues:         number[] = [];
    const postWarmupFrameValues:  number[] = [];

    for (const run of allRuns) {
      allFrameValues.push(...run.frames);
      postWarmupFrameValues.push(...run.frames.slice(warmup));
    }

    return {
      meta: {
        timestamp:      new Date().toISOString(),
        git:            __GIT_HASH__,
        config,
        runCount:       runs,
        framesPerRun:   frames,
        warmupFrames:   warmup,
      },
      runs: allRuns,
      summary: {
        allFrames:        this.metrics(allFrameValues),
        postWarmupFrames: this.metrics(postWarmupFrameValues),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Live rolling-window report (used outside benchmark runs, e.g. from devtools)
  // ---------------------------------------------------------------------------

  /**
   * Call update() each frame with the probe you pass into sim.update().
   * This keeps the rolling window fresh without needing a PerformanceObserver.
   * Usage (in app.ts ticker):
   *   this.bench.frameUpdate(this.bench.probe);
   */
  report(): void {
    if (!BENCH_ENABLED) return;

    // Drain whatever the probe has accumulated so far
    const out: Record<string, { avg: number; p95: number; p99: number; n: number }> = {};
    for (const [name, values] of this.probe.timings) {
      const m = this.metrics(values);
      out[`⏱ ${name}`] = { avg: +m.avg.toFixed(3), p95: +m.p95.toFixed(3), p99: +m.p99.toFixed(3), n: values.length };
    }
    for (const [name, values] of this.probe.counts) {
      const m = this.metrics(values);
      out[`# ${name}`] = { avg: +m.avg.toFixed(1), p95: +m.p95.toFixed(1), p99: +m.p99.toFixed(1), n: values.length };
    }
    console.table(out);
  }

  /**
   * Expose the probe so app.ts can pass it into sim.
   * In prod, return undefined — use "optional chaining" where used, eg: probe?.spanStart("sim:frame")
   */
  get getProbe(): SimProbe | undefined {
    return BENCH_ENABLED ? this.probe : undefined;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private metrics(values: number[]): ComponentMetrics {
    if (values.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    return {
      avg,
      p50: sorted[Math.floor(sorted.length * 0.50)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  private save(data: BenchmarkRecord): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `bench_${data.meta.git}_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}