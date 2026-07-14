import { ParticleSimulator } from "../src/sim/simulation"
import { BenchmarkingTool, type SimProbe } from "./benchmark/benchmark"
import { clamp } from "../src/core/util.ts";
import "../src/config/interfaces.d.ts"

interface SimLiveParams {
    speed: number;
    typeRMax: number[];
    typeBeta: number[];
    friction: number;
    rules: number[];
    spatialModuleName: SpatialModuleName;
    boundaryMode: BoundaryMode;
    maxAccel: number;
}
interface Run {
    init: number;
    worker: number;
    postWorker: number;
}

export class SimTester {
    sim: ParticleSimulator | undefined = undefined;
    bench: BenchmarkingTool | undefined = undefined;
    probe: LiveProbe | undefined = undefined;
    cpuCorePercent: number = 1;

    readonly testRules = [
      -0.7824554443359375, -0.5159652233123779, -0.7399479150772095,
       0.7869302034378052, -0.7077521681785583,  0.7734294533729553,
      -0.9772785305976868,  0.8419510126113892, -0.7135220766067505 
    ]
    readonly simConfig: Config = {
        seed: "test-seed",
        particleCount: 10000,
        typeCount: 3,
        simWidth: 3333,
        simHeight: 1875,
        spacing: 25
    }
    simLiveParams = {
        speed: 0.1,
        typeRMax: [100, 100, 100],
        typeBeta: [0.3, 0.3, 0.3],
        friction: 0.05,
        rules: this.testRules,
        spatialModuleName: "GRID",
        boundaryMode: "WRAP",
        maxAccel: 25,
    } as SimLiveParams;

    
    applyLiveParams(str: SimParameter = "all"): void {
        if (!this.sim) return;
        switch (str) {
            case "speed": {
                this.sim.speedLive = this.simLiveParams.speed;
                break;
            }
            case "rMax": {
                this.sim.rMaxLive = this.simLiveParams.typeRMax;
                break;
            }
            case "beta": {
                this.sim.betaLive = this.simLiveParams.typeBeta;
                break;
            }
            case "friction": {
                this.sim.frictionLive = this.simLiveParams.friction;
                break;
            }
            case "rules": {
                this.sim.rulesLive = this.simLiveParams.rules;
                break;
            }
            case "boundary": {
                this.sim.boundaryModeLive = this.simLiveParams.boundaryMode;
                break;
            }
            case "maxAccel": {
                this.sim.maxAccelLive = this.simLiveParams.maxAccel;
                break;
            }
            case "all": {
                this.sim.speedLive = this.simLiveParams.speed;
                this.sim.rMaxLive = this.simLiveParams.typeRMax;
                this.sim.betaLive = this.simLiveParams.typeBeta;
                this.sim.frictionLive = this.simLiveParams.friction;
                this.sim.rulesLive = this.simLiveParams.rules;
                this.sim.boundaryModeLive = this.simLiveParams.boundaryMode;
                this.sim.maxAccelLive = this.simLiveParams.maxAccel;
                break;
            }
        }
        this.sim.NEW_CHANGE = true;
    }

    private async createNewSim() {
        this.sim = new ParticleSimulator(this.simConfig, "GRID", this.probe, this.cpuCorePercent);
        this.applyLiveParams()
        await this.sim.ready()
    }
    private async terminateSim() {
        await this.sim?.terminate()
    }
    private createProbe() {
        this.probe = new LiveProbe;
    }
    private readProbe(): [timings: Map<string, number[]>, counts: Map<string, number[]>] {
        return [this.probe!.timings, this.probe!.counts]
    }
    private destroyProbe() {
        this.probe = undefined;
    }
    private parseProbe(): Run {
        const [timings, counts] = this.readProbe();
        const initTimings = timings.get("sim:update:updateParamBuffers");
        const workerTimings = timings.get("sim:update:workers");
        const postWorkerTimings = timings.get("sim:update:referenceCurrentPos");
        const init = initTimings?.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        const workers = workerTimings?.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        const postWorkers = postWorkerTimings?.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        return {
            init: init,
            worker: workers,
            postWorker: postWorkers
        } as Run
    }

    async testSim(frames: number = 500) {
        for (let i = 0; i < frames; i++) {
            await this.sim?.update(1);
        }
    }

    async sweepCpuAmountWithProbe(frames: number = 500) {
        console.log("SWEEPS START");
        const cores = navigator.hardwareConcurrency;
        const totalStart = performance.now();
        let sweep: Run[] = [];
        const sweeps: Array<Array<Run>> = [];
        let times: Array<Array<number>> = Array(cores);
        for (let repeat = 0; repeat < 10; repeat++) {
            console.log(`Sweep ${repeat + 1}/10  start:`)
            sweep = [];
            const repeatStart = performance.now()
            for (let i = 0; i < cores * 2; i++) {
                
                const coresPercent = (i + 1) / cores;
                console.log(`
                    --- TEST ${i} ---
                    CPU Cores %: ${coresPercent * 100}% 
                    Workers Expected: ${i + 1}
                    Workers Literal: ${clamp(Math.ceil(coresPercent * cores), 1, cores * 2)}`);
                this.cpuCorePercent = coresPercent;
                this.createProbe();
                await this.createNewSim();
                const start = performance.now();
                await this.testSim(frames);
                const end = performance.now();
                await this.terminateSim();
                const run: Run = this.parseProbe();
                this.destroyProbe();
                sweep.push(run);
                console.log(`Time taken: ${end - start}`);
                const time = end - start
                if (times[i]) {
                    times[i].push(time)
                } else {
                    times[i] = [time]
                }
            }
            sweeps.push(sweep)
            console.log(`Sweep took ${performance.now() - repeatStart}ms`)
            console.log(sweeps)
        }
        console.log(`All times:`);
        console.log(times);
        console.log(sweeps);
        console.log("SWEEPS COMPLETE");
        console.log(`Sweep took: ${performance.now() - totalStart}`)
    }

    async sweepCpuAmount(frames: number = 10000) {
        console.log("SWEEP START");
        const cores = navigator.hardwareConcurrency;
        const totalStart = performance.now();
        let times: Array<Array<number>> = Array(cores);
        for (let repeat = 0; repeat < 1; repeat++) {
            for (let i = 0; i < cores; i++) {
                const coresPercent = (i + 1) / cores;
                console.log(`
                    --- TEST ${i} ---
                    CPU Cores %: ${coresPercent * 100}% 
                    Workers Expected: ${i + 1}
                    Workers Literal: ${clamp(Math.ceil(coresPercent * cores), 1, cores)}`);
                this.cpuCorePercent = coresPercent;
                await this.createNewSim();
                const start = performance.now();
                await this.testSim(frames);
                const end = performance.now();
                await this.terminateSim()
                console.log(`Time taken: ${end - start}`);
                const time = end - start
                if (times[i]) {
                    times[i].push(time)
                } else {
                    times[i] = [time]
                }
            }
        }
        console.log(`All times:`);
        console.log(times)
        console.log("SWEEP COMPLETE");
        console.log(`Sweep took: ${performance.now() - totalStart}`)
    }
}

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