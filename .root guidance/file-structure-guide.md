# Project File Structure — Evolution Guidance

Companion to the *Architecture & Implementation Guide* and the *Correctness Oracle* document. This one answers a smaller but persistent question: **how the codebase should be organised at each stage of the roadmap**, starting from the current four files. Structure is presented per stage so refactors happen exactly when the architecture demands them, not speculatively.

---

## 0. Principles (why the tree looks the way it does)

1. **Folders follow the boundaries that matter.** The architecture's load-bearing boundaries are: pure shared logic ↔ sim backends ↔ render layer ↔ UI ↔ thread/GPU bridges. Each gets a home; a file that straddles two boundaries is a file that will rot.
2. **A "shared kernel" exists and stays dependency-free.** The force rule, params definition, PRNG, and snapshot format are referenced by *every* backend and by the test harness. They MUST NOT import the DOM, Pixi, WebGPU, or anything environment-specific — they must run identically in the main thread, a worker, Node (CI), and conceptually in WGSL.
3. **Backends are siblings behind one interface.** JS oracle, worker-hosted JS, WASM, WebGPU — all expose the same surface (`init/loadSnapshot/step/dumpSnapshot/metrics`, per the oracle doc §6.2). The harness and `main.js` never know which one they hold. New backend = new folder, zero changes elsewhere.
4. **Every boundary crossing is one named module.** The SAB memory layout, the GPU device/buffer setup, the worker message protocol — each lives in exactly one file that both sides import. Duplicate layout constants in two files are a desync waiting to happen.
5. **Deliberately duplicated logic is co-located and parity-tested.** The force rule will eventually exist twice: JS (`core/rules.js`) and WGSL (`gpu/shaders/`). They cannot share code, so they share a folder convention, a header comment pointing at each other, and a **rule-parity test** (evaluate both over a sampled (r, a) grid, compare within ULP-scale tolerance).
6. **Tests and the oracle are first-class**, not an afterthought directory. The corpus snapshots are version-controlled artefacts.

---

## 1. Where you are now → minimal renaming

Current files map cleanly; nothing is wasted:

| Current | Becomes | Why |
|---|---|---|
| `src/main.js` | stays `src/main.js` | entry point; stays thin forever (wire modules, own the rAF loop) |
| `src/simulation.js` | splits into `src/sim/*` | the three passes (grid/forces/integrate) deserve separate files — they are ported and validated independently |
| `src/renderer.js` | moves to `src/render/` | will be rewritten twice (Stage 1, Stage 5); isolating it keeps churn contained |
| `src/rules.js` | promoted to `src/core/rules.js` | it is the shared kernel's crown jewel — pure, dependency-free, future WGSL twin |

---

## 2. Stage 0–1 layout (oracle + direct-buffer rendering)

```
src/
  main.js                  entry: builds params, picks backend, owns frame loop
  config/
    params.js              the single params struct: defaults, validation, K_MAX
    presets.js             canonical seeds / matrices (shared with test corpus)
  core/                    ── shared kernel: pure, environment-free ──
    rules.js               force curve f(r, a, beta)
    prng.js                mulberry32 + seeded helpers (matrix gen, scatter init)
    snapshot.js            serialize / load / hash (oracle doc §6.1)
    relmatrix.js           K_MAX-stride helpers, randomisers (full/symmetric/row)
  sim/                     ── the JS backend == the oracle ──
    grid.js                counting sort: histogram, prefix sum, scatter
    forces.js              gather pass (3×3 neighbourhood, min-image)
    integrate.js           semi-implicit Euler, friction, boundary modes
    backend-js.js          assembles passes behind the common backend interface
    bruteforce.js          O(n²) Tier-A twin (imported by tests only) - move to test/ somewhere
  render/
    renderer.js            Stage 1: instanced geometry, direct buffer feed (Pixi host)
    colors.js              golden-angle palette generation (CPU side)
test/
  unit/                    force-rule, grid, min-image, integrator, scan tests - structure mimics src structure
  harness.js               run(snapshot, T, backend) → {snapshot, hash, metrics}
  corpus/                  pair-analytic.snap, trio-chase.snap, uniform-1k.snap, …
docs/
  architecture-guide.md, oracle-guide.md, file-structure.md (this file)
```

Rules at this stage: `core/` imports nothing from `sim/`, `render/`, or the DOM. `sim/` imports only `core/` and `config/`. `render/` never imports `sim/` internals — it receives typed arrays/buffers from `main.js`. `simulation.js`'s old responsibility (pass orchestration) lives in `backend-js.js`.

---

## 3. Stage 2 layout additions (worker + SharedArrayBuffer)

```
src/
  bridge/
    sab-layout.js          THE single definition of SAB offsets/sizes (pos, vel,
                           type, rel, params mirror, prev-pos for interpolation)
    sim-worker-protocol.js message types: loadSnapshot, setRel, setParams, pause…
  workers/
    sim.worker.js          hosts backend-js inside the worker; reads commands,
                           steps, publishes tick counter
  sim/
    backend-worker.js      main-thread proxy implementing the same backend
                           interface, backed by the worker + SAB
```

Notes: `sab-layout.js` is principle 4 incarnate — both `sim.worker.js` and `backend-worker.js` import it; offsets appear nowhere else. The worker hosts the *unchanged* `backend-js.js` (which is why Stage 2 is a Class 1 bit-exact gate). COOP/COEP header configuration lives in the dev-server/deploy config, not in `src/` — but document it in the README because its absence fails silently.

---

## 4. Stage 3a layout additions (optional WASM backend)

```
wasm/                      ── Rust crate at repo root, OUTSIDE src/ ──
  Cargo.toml
  src/lib.rs               step(): grid + forces + integrate over linear memory
  src/simd.rs              f32x4 inner-loop variants
src/
  sim/
    backend-wasm.js        loads the .wasm, creates typed-array views over linear
                           memory at the sab-layout offsets, implements the
                           common backend interface
```

Notes: the crate sits outside `src/` because it has its own toolchain, build artefacts, and lockfile; only the compiled `.wasm` (and glue) enters the JS build, ideally into a `generated/` or `dist-wasm/` directory that is gitignored and produced by a documented build script. Keep the Rust port a deliberate *transliteration* of `sim/*.js` — same pass names, same function granularity — so diffs between oracle and port are reviewable side by side. Record the exact build flags (no fast-math, no FMA contraction) next to the build script; they are a Class 1 precondition.

---

## 5. Stage 3b–4 layout additions (WebGPU compute)

```
src/
  gpu/
    device.js              adapter/device acquisition, capability checks, loss handling
    buffers.js             creates ALL buffers at N_MAX/K_MAX capacity; the single
                           place that knows sizes, usages, and the params-uniform
                           byte layout (offsets documented here, nowhere else)
    bindgroups.js          layouts + groups for each pass
    passes.js              records the per-frame command order (guide §7.3)
    shaders/
      common.wgsl          structs (Params), constants, shared helpers
      force_rule.wgsl      WGSL twin of core/rules.js  ← parity-tested
      grid_clear.wgsl
      grid_histogram.wgsl
      grid_scan.wgsl       prefix sum (unit-tested standalone before integration)
      grid_scatter.wgsl
      forces.wgsl
      integrate.wgsl
    compose.js             WGSL has no #include: this concatenates common +
                           force_rule + pass source at pipeline-creation time
  sim/
    backend-webgpu.js      common backend interface over gpu/* ; owns ping-pong
                           swap; implements dumpSnapshot via (debug-only) readback
test/
  unit/scan.test.js        CPU-vs-GPU scan over random inputs
  unit/rule-parity.test.js JS rules.js vs force_rule.wgsl over sampled (r, a) grid
```

Notes: one `.wgsl` file per dispatch, named identically to the pass order in the architecture guide §7.3, so the guide, the code, and the per-phase debugging playbook (oracle doc §9.2) all speak the same names. `compose.js` is the honest answer to WGSL's lack of includes — string concatenation at pipeline build, kept in one place. The interim CPU-grid-upload mode (Stage 3b) is a flag inside `backend-webgpu.js` that swaps the three grid dispatches for an upload — not a separate backend.

---

## 6. Stage 5 layout (endgame: native renderer, effects, full UI)

```
src/
  main.js
  config/        params.js, presets.js, url-config.js (seed/params ⇄ URL sharing)
  core/          rules.js, prng.js, snapshot.js, relmatrix.js
  bridge/        sab-layout.js, sim-worker-protocol.js        (if worker retained)
  workers/       sim.worker.js                                 (CPU fallback path)
  sim/
    grid.js  forces.js  integrate.js  bruteforce.js
    backend-js.js  backend-worker.js  backend-wasm.js  backend-webgpu.js
    backend.md             the interface contract, in prose (what every backend
                           must implement; mirrors oracle doc §6.2)
  gpu/
    device.js  buffers.js  bindgroups.js  passes.js  compose.js
    shaders/   (as §5, plus:)
      render_particles.wgsl   instanced quad vertex+fragment, camera uniform,
                              soft-sprite falloff, velocity stretch, type colour
      trail_fade.wgsl         persistence fade pass
      blit.wgsl               trail texture → swapchain
  render/
    renderer-webgpu.js     render+effects pass recording; owns trail texture
    renderer-pixi.js       legacy/fallback path (Stage 1 code), kept while useful
    effects.js             effect toggles/factors → uniforms (never touches sim)
    colors.js              CPU palette gen (only if user-editable palette ships)
  ui/
    controls.js            sliders/buttons bound to the params struct
    matrix-editor.js       K² sliders (small K) / canvas heatmap (large K)
    stats.js               fps, sim Hz, n, avg-neighbours overlay
test/   unit/  harness.js  corpus/
docs/   the three guidance documents
wasm/   (if Stage 3a was taken)
```

---

## 7. Conventions checklist

- [ ] `core/` has zero imports from anywhere except `core/` itself — enforce by review or a lint rule
- [ ] Every backend implements the identical interface; `main.js` selects one via a single factory and a query/param flag (this is also how the harness drives them)
- [ ] SAB offsets defined once (`bridge/sab-layout.js`); GPU buffer sizes/usages and the params-uniform byte layout defined once (`gpu/buffers.js`)
- [ ] Pass names are identical across `sim/*.js`, `gpu/shaders/*.wgsl`, the guide §7.3, and per-phase timings — one vocabulary end to end
- [ ] `core/rules.js` and `gpu/shaders/force_rule.wgsl` carry header comments pointing at each other; `rule-parity.test.js` exists and runs in CI
- [ ] Effects code lives under `render/` and is structurally incapable of writing sim state (it receives read-only buffers)
- [ ] No file in `src/` imports build artefacts directly from `wasm/` — only from the generated output directory the build script produces
- [ ] Bundler config supports: worker bundling, raw-text import of `.wgsl` (or `compose.js` fetches them), COOP/COEP headers in dev; all three noted in the README
- [ ] Deleting `render/renderer-pixi.js` at the end of Stage 5 is a planned event, not an accident — keep it until the WebGPU renderer passes the Stage 5 gate on target hardware
