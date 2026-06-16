// Stable Application Controller
// Orchistrates application running

import { Application, Ticker } from 'pixi.js';
import { ParticleSimulator } from '../sim/simulation';
import { Renderer } from '../render/render';
import { BenchmarkingTool } from '../../test/benchmark/benchmark';

const BENCH_ENABLED = import.meta.env.DEV;

export class AppController {
    app!:   Application; // assuring it is assigned before use with !, check first if errors
    sim:    ParticleSimulator | null = null;
    ren:    Renderer | null          = null;
    bench:  BenchmarkingTool | null  = null;

    // init default params
    simParams = {
        // rebuild on change
        seed: Math.random() as number | string, // Future: may create a string library to pick/string constructor from for easier default reproducibility
        particleCount: 10000, 
        typeCount: 3,
        simWidth: window.innerWidth,
        simHeight: window.innerHeight,
        // live, rebuild not needed
        speed: 0.1,
        rMax: 100,
        beta: 0.3,
        friction: 0.05,
        rules: null as Float64Array | null
    };

    private tickerInstance: ((ticker: Ticker) => void) | null = null

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
            window.__app = this;
            this.bench = new BenchmarkingTool(120);
            window.__bench = this.bench;
            window.__startBench =  this.startBench
            
        }
    }
    private startBench(frames: number, runs: number, warmup: number, fullConfig: FullConfig) {
        this.simParams = fullConfig
        this.startFullConfigHeadlessSim(fullConfig)
        this.applyLiveParams()
        const tick = () => this.sim!.update(1) // fixed dt for reproducibility
        this.bench!.startBenchmarkRun(
            frames, runs, warmup, fullConfig, tick  
        );
    }

    private applyLiveParams() {
        if (!this.sim) return;
        this.sim.speed = this.simParams.speed
        this.sim.rMax = this.simParams.rMax
        this.sim.beta = this.simParams.beta
        this.sim.friction = this.simParams.friction
        console.assert((this.simParams.rules !== null), "Attempting to apply null value rules")
        this.sim.rules = this.simParams.rules!
    }

    startSim() {
        this.clearRunning() // clean up existing if any
        const config: Config = this.simParams
        this.sim = new ParticleSimulator(config);
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

    private startFullConfigHeadlessSim(fullConfig: FullConfig) {
        this.clearRunning()

        this.sim = new ParticleSimulator(fullConfig);
        this.sim = Object.assign(this.sim, fullConfig)
    }

    clearRunning() {
        if (this.tickerInstance) {
            this.app.ticker.remove(this.tickerInstance);
            this.tickerInstance = null;
        }
        if (this.ren) {
            this.app.stage.removeChild(this.ren.container);
            this.ren = null;
        }
        this.sim = null;
    }

    pauseLoop() {
        this.app.ticker.stop();
    }
    resumeLoop() {
        this.app.ticker.start();
    }
    

}