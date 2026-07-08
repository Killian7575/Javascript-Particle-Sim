// Stable Application Controller
// Orchistrates application running

import { Application } from 'pixi.js';
import { ParticleSimulator } from '../sim/simulation';
import { Renderer } from '../render/render';
import { BenchmarkingTool, type SimProbe } from '../../test/benchmark/benchmark';

const BENCH_ENABLED = import.meta.env.DEV;

interface SimStaticParams {
    seed: number | string;
    particleCount: number;
    typeCount: number;
    simWidth: number;
    simHeight: number;
}
interface SimLiveParams {
    speed: number;
    typeRMax: number[];
    typeBeta: number[];
    friction: number;
    rules: number[];
    spatialModuleName: SpatialModuleName;
    boundaryMode: BoundaryMode;
}

export class AppController {
    app!:   Application; 
    sim:    ParticleSimulator | undefined = undefined;
    ren:    Renderer          | undefined = undefined;
    bench:  BenchmarkingTool  | undefined = undefined;

    lastFrame: number = 0;
    loop: () => void = this.frameLoop.bind(this)

    densityAim = 625
    // init default params
    simStaticParams = {
        // rebuild on change
        seed:           Math.random() as number | string, // Future: may create a string library to pick/string constructor from for easier default reproducibility
        particleCount:  Math.floor(window.innerWidth * window.innerHeight / this.densityAim), 
        typeCount:      3,
        simWidth:       window.innerWidth,
        simHeight:      window.innerHeight,
    } as SimStaticParams;
    simLiveParams = {
        speed: 0.1,
        typeRMax: Array(this.simStaticParams.typeCount),
        typeBeta: Array(this.simStaticParams.typeCount),
        friction: 0.05,
        rules: Array(this.simStaticParams.typeCount ** 2),
        spatialModuleName: "GRID",
        boundaryMode: "WRAP",
    } as SimLiveParams;
    readonly testRules = [
      -0.7824554443359375, -0.5159652233123779, -0.7399479150772095,
       0.7869302034378052, -0.7077521681785583,  0.7734294533729553,
      -0.9772785305976868,  0.8419510126113892, -0.7135220766067505 
    ]

    // private tickerInstance: ((ticker: Ticker) => void) | undefined = undefined;

    private probe: SimProbe | undefined = undefined;

    async init() {
        this.app = new Application();
        await this.app.init({
            width:           window.innerWidth,
            height:          window.innerHeight,
            backgroundColor: 0x111111,
            resizeTo: window
        });
        document.body.appendChild(this.app.canvas);
        this.app.ticker.maxFPS = 60;

        if (BENCH_ENABLED) {
            this.bench = new BenchmarkingTool();
            this.probe = this.bench.getProbe;

            // Expose to browser devtools
            window.__app = this;
            window.__bench = this.bench;
            window.__startBench = (frames: number = 10000, runs: number = 3, warmup: number = 60, cfg: FullConfig) =>
                this.runBench(frames, runs, warmup, cfg);
        }
        this.simLiveParams.typeBeta.fill(0.3);
        this.simLiveParams.typeRMax.fill(100);
        if (this.simStaticParams.typeCount === 3) {
            this.simLiveParams.rules = this.testRules;
        } 
    }

    private runBench(frames: number, runs: number, warmup: number, fullConfig: FullConfig) {
        if (!this.bench) return;
        const t0 = performance.now();
        // clear the live render loop so it doesn't interfere with timings
        this.clearRunning()
    
        this.bench.benchmarkRun(
            frames,
            runs,
            warmup,
            fullConfig,
            (cfg, probe) => {
                // Factory: create a fresh headless sim for each run
                const sim = new ParticleSimulator(cfg, "GRID", probe); // TEMP HARDCODED MODULE METHOD
                // Apply any overrides from fullConfig (speed, rMax, etc.)
                return Object.assign(sim, cfg);
            },
        );
        const ms = performance.now() - t0
        function deriveMinutesAndSeconds(ms: number): Number {
            const minutes = ((ms / 1000) / 60) ;
            const remainderMin = minutes - Math.floor(minutes);
            return (Math.floor(minutes) + (remainderMin * 0.6));
        }
        const minutesAndSeconds = deriveMinutesAndSeconds(ms)
        const perRun = deriveMinutesAndSeconds(ms / runs);
        const per1000Frames = deriveMinutesAndSeconds(ms * (1000 / (runs * frames)));
        console.log("Benchmark Complete");
        console.log(`Total Runtime: ${minutesAndSeconds.toFixed(2)} minutes.seconds, ${ms.toFixed(1)}ms`);
        console.log(`Per Run: ${perRun.toFixed(2)} minutes.seconds`);
        console.log(`Per 1000 frames: ${per1000Frames.toFixed(2)} minutes.seconds`);
    }

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
            case "all": {
                this.sim.speedLive = this.simLiveParams.speed;
                this.sim.rMaxLive = this.simLiveParams.typeRMax;
                this.sim.betaLive = this.simLiveParams.typeBeta;
                this.sim.frictionLive = this.simLiveParams.friction;
                this.sim.rulesLive = this.simLiveParams.rules;
                this.sim.boundaryModeLive = this.simLiveParams.boundaryMode;
                break;
            }
        }
        this.sim.NEW_CHANGE = true;
    }


    async startSim() {
        this.clearRunning()
        const config: Config = this.simStaticParams
        this.sim = new ParticleSimulator(config, this.simLiveParams.spatialModuleName, this.probe);
        if (!this.simLiveParams.rules) {
            this.simLiveParams.rules = this.sim.rulesLive
        }
        this.applyLiveParams()
        await this.sim.ready()


        this.ren = new Renderer(this.sim)
        this.app.stage.addChild(this.ren.container);

        window.requestAnimationFrame(this.loop);
    }

    clearRunning() {
        if (this.ren) {
            this.app.stage.removeChild(this.ren.container);
            this.ren = undefined;
        }
        this.sim = undefined;
    }

    async frameLoop() {
        const { sim, ren } = this
        console.log("frameLoop'd")
        await sim?.update(1)
        ren?.sync(this.sim);
        window.requestAnimationFrame(this.loop);
    }

    pauseLoop()  { this.app.ticker.stop();  }
    resumeLoop() { this.app.ticker.start(); }
    

}