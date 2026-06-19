import { BenchmarkingTool } from '../test/benchmark/benchmark.js';
import { AppController } from './app/app.js';
import { mountUI } from './ui/index.js';

// Prepare to expose to browser dev console
declare global {
  interface Window {
    __bench: BenchmarkingTool;
    __app: AppController;
    __startBench: any; // "any" while i develop/understand function
  }
}

const control = new AppController();
await control.init()
control.startSim()
mountUI(control);

// setTimeout(() => {
//   control.pauseLoop()
// }, 2000)