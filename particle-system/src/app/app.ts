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
        seed: Math.random(), // Future: may create a string library to pick/string constructor from for easier default reproducibility
        count: 10000, 
        numTypes: 3,
        // live, rebuild not needed
        speed: 0.1,
        rMax: 100,
        beta: 0.3,
        friction: 0.05,
        rules: null as Float32Array | null
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
            this.bench = new BenchmarkingTool(120);
            window.__bench = this.bench;
            window.__app = this;
        }
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

        this.sim = new ParticleSimulator(
            this.simParams.seed, this.simParams.count, this.simParams.numTypes,
            this.app.screen.width, this.app.screen.height
        );
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
    startHeadlessSim(config: Config) {
        this.clearRunning()

        const { seed, particleCount: count, typeCount: numTypes, simWidth: width, simHeight: height } = config

        this.sim = new ParticleSimulator(
            seed, count, numTypes,
            width, height
        );

        return this.sim.update
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