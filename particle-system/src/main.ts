import { BenchmarkingTool } from '../test/benchmark/benchmark.js';
import { AppController } from './app/app.js';

// Prepare to expose to browser dev console
declare global {
  interface Window {
    __bench: BenchmarkingTool;
    __app: AppController;
  }
}

const control = new AppController();
await control.init()

control.startSim()