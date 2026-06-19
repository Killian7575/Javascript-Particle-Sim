// Stable Application Controller
// Orchistrates application running

import { Application, Ticker } from 'pixi.js';
import { ParticleSimulator } from '../sim/simulation';
import { Renderer } from '../render/render';
import { BenchmarkingTool, type SimProbe } from '../../test/benchmark/benchmark';

const BENCH_ENABLED = import.meta.env.DEV;


export class AppController {
    app!:   Application; 
    sim:    ParticleSimulator | undefined = undefined;
    ren:    Renderer          | undefined = undefined;
    bench:  BenchmarkingTool  | undefined = undefined;

    // init default params
    simParams = {
        // rebuild on change
        seed:           Math.random() as number | string, // Future: may create a string library to pick/string constructor from for easier default reproducibility
        particleCount:  10000, 
        typeCount:      3,
        // live, rebuild not needed
        simWidth:       window.innerWidth,
        simHeight:      window.innerHeight,
        speed:          0.1,
        rMax:           100,
        beta:           0.3,
        friction:       0.05,
        rules:          undefined as Float64Array | undefined
    };

    private tickerInstance: ((ticker: Ticker) => void) | undefined = undefined;

    private probe: SimProbe | undefined = undefined;

    async init() {
        this.app = new Application();
        await this.app.init({
            width:           window.innerWidth,
            height:          window.innerHeight,
            backgroundColor: 0x111111,
        });
        document.body.appendChild(this.app.canvas);
        this.app.ticker.maxFPS = 60;

        if (BENCH_ENABLED) {
            this.bench = new BenchmarkingTool();
            this.probe = this.bench.getProbe;

            // Expose to browser devtools
            window.__app = this;
            window.__bench = this.bench;
            window.__startBench = (frames: number, runs: number, warmup: number, cfg: FullConfig) =>
                this.runBench(frames, runs, warmup, cfg);

            
        }
    }

    private runBench(frames: number, runs: number, warmup: number, fullConfig: FullConfig) {
        if (!this.bench) return;
        const t0 = performance.now()
        // Pause the live render loop so it doesn't interfere with timing
        this.pauseLoop();
    
        this.bench.benchmarkRun(
            frames,
            runs,
            warmup,
            fullConfig,
            (cfg, probe) => {
                // Factory: create a fresh headless sim for each run
                const sim = new ParticleSimulator(cfg, probe);
                // Apply any overrides from fullConfig (speed, rMax, etc.)
                return Object.assign(sim, cfg);
            },
        );
        const ms = performance.now() - t0
        function deriveMinutesAndSeconds(ms: number): Number {
            const minutes = ((ms / 1000) / 60) 
            const remainderMin = minutes - Math.floor(minutes)
            return (Math.floor(minutes) + (remainderMin * 0.6))
        }
        const minutesAndSeconds = deriveMinutesAndSeconds(ms)
        const perRun = deriveMinutesAndSeconds(ms / runs);
        const per1000Frames = deriveMinutesAndSeconds(ms * (1000 / (runs * frames)));
        console.log("Benchmark Complete")
        console.log(`Total Runtime: ${minutesAndSeconds.toFixed(2)} minutes.seconds, ${ms.toFixed(1)}ms`)
        console.log(`Per Run: ${perRun.toFixed(2)} minutes.seconds`)
        console.log(`Per 1000 frames: ${per1000Frames.toFixed(2)} minutes.seconds`)
        this.resumeLoop();
    }

    applyLiveParams(str: SimParameter = "all"): void {
        if (!this.sim) return;
        switch (str) {
            case "simSize": {
                this.sim.simWidth = this.simParams.simWidth
                this.sim.simHeight = this.simParams.simHeight
                break;
            }
            case "speed": {
                this.sim.speed = this.simParams.speed
                break;
            }
            case "rMax": {
                this.sim.rMax = this.simParams.rMax
                break;
            }
            case "beta": {
                this.sim.beta = this.simParams.beta
                break;
            }
            case "friction": {
                this.sim.friction = this.simParams.friction
                break;
            }
            case "rules": {
                console.assert((this.simParams.rules !== undefined), "Attempting to apply undefined rules")
                this.sim.rules = this.simParams.rules!
                break;
            }
            case "all": {
                this.sim.simWidth = this.simParams.simWidth
                this.sim.simHeight = this.simParams.simHeight
                this.sim.speed = this.simParams.speed
                this.sim.rMax = this.simParams.rMax
                this.sim.beta = this.simParams.beta
                this.sim.friction = this.simParams.friction
                console.assert((this.simParams.rules !== undefined), "Attempting to apply undefined rules")
                this.sim.rules = this.simParams.rules!
                break;
            }
        }
    }


    startSim() {
        this.clearRunning()
        const config: Config = this.simParams
        this.sim = new ParticleSimulator(config, this.probe);
        this.simParams.rules = this.sim.rules
        this.applyLiveParams()

        this.ren = new Renderer(this.sim)
        this.app.stage.addChild(this.ren.container);

        this.tickerInstance = (ticker) => {
            this.sim!.update(ticker.deltaTime);
            this.ren!.sync(this.sim!);
        };
        this.app.ticker.add(this.tickerInstance);
    }

    clearRunning() {
        if (this.tickerInstance) {
            this.app.ticker.remove(this.tickerInstance);
            this.tickerInstance = undefined;
        }
        if (this.ren) {
            this.app.stage.removeChild(this.ren.container);
            this.ren = undefined;
        }
        this.sim = undefined;
    }

    pauseLoop()  { this.app.ticker.stop();  }
    resumeLoop() { this.app.ticker.start(); }
    

}