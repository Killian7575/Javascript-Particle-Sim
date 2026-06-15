import { ParticleSimulator } from './simulation.js';
import { Renderer } from './render.js';
import { Application, Ticker } from 'pixi.js';
import { BenchmarkingTool } from './benchmark.js';

const BENCH_ENABLED = import.meta.env.DEV;

async function setup() {

  let app = new Application();

  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x111111,
    // resizeTo: window 
  });

  document.body.appendChild(app.canvas);
  
  
  let sim = new ParticleSimulator(10000, 3, app.screen.width, app.screen.height)
  let ren = new Renderer(sim)

  app.stage.addChild(ren.container)

  app.ticker.maxFPS = 60;

  // Every frame update simulation and renderer
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    sim.update(dt);
    ren.sync(sim)
  });
}

// --- Start Benchmarker ---
let bench = new BenchmarkingTool(120)
// --- Start the system ---
setup();

// Expose BenchmarkingTool to browser dev console
declare global {
  interface Window {
    __bench: BenchmarkingTool;
  }
}
if (BENCH_ENABLED) {
  window.__bench = bench;
  // then in browser console: __bench.startBenchmarkRun({ runs: 3 })
}