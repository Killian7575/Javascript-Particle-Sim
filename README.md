# Particle Life Simulation

A multithreaded particle life simulation running in the browser. Thousands of particles interact through an asymmetric attraction/repulsion rule matrix, producing emergent cell-like structures, clusters, and chasing behaviours.

Built as a learning project with a focus on parallel computation on the web: Web Workers coordinated over `SharedArrayBuffer` with `Atomics`, ahead of a planned WebGPU port.

https://github.com/user-attachments/assets/b621fb14-c8b5-4157-82b7-b56a4f75bf6d



## Features

- **CPU-parallel physics** — the force computation is split across a pool of Web Workers, each processing a slice of the particle population per frame. Workers block on `Atomics.wait` and are woken by a shared frame counter; the main thread awaits completion via `Atomics.waitAsync`, so no per-frame `postMessage` traffic or data copying occurs.
- **Zero-copy shared state** — positions, velocities, force accumulators, the rule matrix, and live tuning parameters all live in `SharedArrayBuffer`s visible to every worker. Positions are double-buffered (read/write buffers swapped each frame) so workers can read a consistent snapshot while writing the next frame.
- **Spatial partitioning** — a uniform grid with counting-sort binning (count → prefix sum → scatter) reduces the neighbour search from O(N²) to near-linear. The partitioner sits behind a module interface so alternative structures can be swapped in without touching the force kernel.
- **Runtime-tunable physics** — interaction radius (`rMax`, per type), repulsion band (`beta`, per type), speed, friction, force cap, boundary mode (wrap / bounce / snap), and the full rule matrix can all change on any frame without restarting the simulation.
- **Force-space capping** — accumulated force magnitude is capped (direction-preserving) rather than velocity, keeping the force law Galilean-invariant while bounding the energy injected by the asymmetric rule matrix.
- **Deterministic seeding** — a seeded PRNG (mulberry32 with FNV-1a string hashing) makes runs reproducible for debugging and benchmarking.
- **Rendering** — Pixi.js v8 `ParticleContainer` with additive blending; render layer is decoupled from the simulation and only reads the current position buffer.
- **Headless benchmarking** — a dev-only benchmark harness runs the simulation without rendering for controlled throughput measurements (worker-count sweeps, regression checks).

## Architecture

```
AppController (app.ts)
  ├── ParticleSimulator (simulation.ts)   owns SharedArrayBuffers + worker pool
  │     ├── Worker × N (worker.ts)        force compute + integration per slice
  │     │     └── Grid (grid.ts)          per-worker spatial query cursor
  │     └── PartitionModules.ts           partitioner registry / buffer specs
  └── Renderer (render.ts)                Pixi.js, reads positions only
```

Design principles:

- The app controller is agnostic to simulator internals; the simulator fully owns its own teardown, including its workers.
- The force kernel is agnostic to the partitioner implementation — grid internals (cell size, layout) never leak into the simulation or workers.
- Constants are owned by the layer that uses them rather than shared via cross-boundary module imports.

## Running locally

`SharedArrayBuffer` requires a cross-origin-isolated context, so the dev server must send COOP/COEP headers. These are configured in `vite.config.ts`.

```bash
git clone https://github.com/Killian7575/Javascript-Particle-Sim.git
cd Javascript-Particle-Sim/particle-sim 
npm install
npm run dev
```

Requires a browser with `SharedArrayBuffer` and `Atomics.waitAsync` support (recent Chrome/Edge/Firefox/Safari).

## Status & roadmap

Current milestone: `cpu-parallel-v1.1` (tagged) — parallel CPU simulation.

- **GUI controls** — in progress on the [`react-gui`](../../tree/react-gui) branch: a React control panel for static parameters (particle count, type count, world size/aspect ratio — applied on restart) and live parameters (applied next frame), plus per-type controls and a rules-matrix editor.
- **WebGPU port** — planned: move the force computation to WGSL compute shaders, dispatching per particle. Several CPU-side optimisations (e.g. work-stealing load balancing) were deliberately skipped because the GPU architecture avoids those bottlenecks.

## Stack

TypeScript · Vite · Pixi.js v8 · Web Workers · SharedArrayBuffer / Atomics · React (GUI branch)

## License
Copyright (C) 2026 DufusLupus

This project is licensed under the GNU Affero General Public License v3.0 — see [LICENSE](LICENSE) for the full text.
