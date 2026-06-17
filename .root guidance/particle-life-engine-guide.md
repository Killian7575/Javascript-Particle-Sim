# Particle Life Engine — Architecture & Implementation Guide

A specification and guidance document for building a high-performance, type-based particle interaction simulation ("particle life") in the browser, scaling from a JavaScript prototype to a WebGPU implementation handling 500k–1M+ particles. Written to be consumed by a human developer or an LLM implementing against it.

---

## 0. How to use this document

- This is a **specification and decision guide, not an implementation**. Derive code from it; do not expect copy-paste solutions. Small pseudocode fragments appear only where the exact formula or indexing scheme matters.
- Requirement language: **MUST** = invariant, violating it breaks correctness or the scaling path. **SHOULD** = strong default, deviate only with a stated reason. **MAY** = legitimate option.
- The architecture is staged (Section 9). Each stage ships a working build and has explicit exit criteria. Do not skip the validation oracle (Stage 0).
- The single most important principle, which every section serves: **performance is determined by where data lives and how often it crosses a boundary** (JS↔WASM, CPU↔GPU, object↔array). Minimise crossings; keep data resident where the heaviest compute happens.

---

## 1. Project definition

### 1.1 What the simulation is
- N particles in a 2D world. Each particle has position, velocity, and a type index `t ∈ [0, K)`.
- Every frame, each particle receives a force from every other particle **within a maximum interaction range `rMax`**. Force magnitude depends on distance, the particle's own type, and the other particle's type via a relationship matrix.
- The relationship matrix `rel` holds a scalar in `[-1, 1]` for every ordered type pair. It is **not necessarily symmetric**: `rel[a][b] ≠ rel[b][a]` is allowed and is a feature (asymmetry produces chasing/orbiting behaviours; symmetry produces clustering).

### 1.2 Product requirements
- **Scale target**: 6-digit particle counts (100k+) at 60fps; architecture must have a credible path to 1M+.
- **Live editing** of the relationship matrix: per-pair adjustment and randomised regeneration, taking effect immediately without pausing or rebuilding the sim.
- **Arbitrary number of types K**, changeable at runtime, with **automatic colour assignment** per type (no hand-maintained palette).
- **Optional polish**: glow, trails, motion-responsive rendering ("prettifying effects").
- Current stack: JavaScript, Pixi.js (ParticleContainer) renderer, main-loop structure of `step sim → copy positions to renderer → render`. Pixi MAY be replaced; the data model MUST NOT be.

### 1.3 Non-goals (unless explicitly added later)
- 3D simulation, exact physical realism, deterministic cross-device replay on GPU, collision resolution beyond the force model.

---

## 2. Core data model — invariants

These survive every stage of the project unchanged. Treat them as the project's constitution.

### 2.1 Structure of Arrays (SoA), always
- Particle state MUST live in flat typed arrays, never in per-particle JS objects:
  - `posX: Float32Array(n)`, `posY: Float32Array(n)`
  - `velX: Float32Array(n)`, `velY: Float32Array(n)`
  - `type: Uint32Array(n)` (or Uint8Array if K ≤ 256 and the render path accepts it)
  - `accX/accY: Float32Array(n)` (or a combined acc buffer) as force accumulation output
- Rationale: sequential memory access for CPU cache and JIT, 1:1 mapping to WASM linear memory views, 1:1 mapping to GPU storage buffers, and SIMD lanes require contiguous same-field data.
- On GPU it is idiomatic to interleave position as `array<vec2f>` (`[x0,y0,x1,y1,…]`); this is still SoA in spirit (one array per logical field). Either separate `array<f32>` x/y buffers or interleaved vec2 is acceptable; pick one and be consistent.

### 2.2 Relationship matrix
- Stored as one flat `Float32Array`, row-major, **allocated at a fixed capacity `K_MAX`** (e.g. 64) and indexed with the fixed stride: `rel[a * K_MAX + b]` = force coefficient for a particle of type `a` reacting to a neighbour of type `b`.
- Rationale for `K_MAX` stride: changing K at runtime never reallocates buffers, never rebuilds GPU bind groups, never resizes anything — only the `K` value in the params struct changes and new rows/columns get values.
- The matrix is tiny (K_MAX=64 → 16 KB). It MUST live in its **own dedicated buffer**, separate from particle data, so live edits touch nothing else.

### 2.3 Single params struct
- All global simulation/render parameters live in ONE struct, the single source of truth, mirrored to whatever backend is active: `{ n, K, rMax, dt, frictionHalfLife or friction, beta, forceScale, worldW, worldH, boundaryMode, fadeFactor, seed }`.
- Every UI control writes into this struct (plus the rel matrix); every backend reads from it. This struct + rel matrix IS the "command channel" between UI and sim (Section 8.1).

### 2.4 Frame-loop hygiene
- MUST NOT allocate inside the frame loop (no `new`, no array literals, no closures created per frame, no `push`). All buffers are pre-allocated and reused. Garbage collection pauses are frame drops.
- MUST NOT call across a JS↔WASM or CPU↔GPU boundary per particle. One `step()`/command-submit per frame.

---

## 3. Simulation algorithm specification

Per-frame order: **build spatial grid → compute forces → integrate**. Each phase is a full pass over flat arrays (CPU) or a dispatch (GPU).

### 3.1 Spatial bucketing: uniform grid, counting sort
- Grid cell size MUST equal `rMax` (or slightly larger). Guarantee: any particle within `rMax` of particle P lies in P's cell or one of its 8 neighbours. Therefore the force pass checks exactly the 3×3 cell neighbourhood — no in-range particle is ever missed; out-of-range candidates are bounded.
- MUST NOT use arrays-of-arrays (`grid[cell].push(i)`): it allocates per frame and scatters memory. Use a **counting sort** over reusable flat arrays:
  1. **Histogram pass**: for each particle, compute `cell = floor(y/cellSize)*gridW + floor(x/cellSize)`, record it in `cellOf[i]`, increment `cellCount[cell]`.
  2. **Prefix-sum pass**: exclusive scan of `cellCount` into `cellStart`, so `cellStart[c]` is the offset where cell c's particles begin; `cellStart[numCells] = n`.
  3. **Scatter pass**: using a cursor copy of `cellStart`, write each particle index into `sorted[]` grouped by cell.
- Result: "all particles in cell c" = `sorted[cellStart[c] .. cellStart[c+1])`. Zero allocation; identical structure on CPU, WASM, and GPU.
- Optimisation (SHOULD, at ≥100k particles): periodically reorder the **actual particle arrays** into cell order instead of (or in addition to) sorting indices, so spatial neighbours are memory neighbours — large cache/coalescing win.

### 3.2 Force pass — gather formulation (mandatory)
- Each particle **gathers**: it reads its neighbours and accumulates its own force. MUST NOT use the scatter formulation (per-pair, write to both particles): scatter requires atomic float writes, which do not exist on GPU and serialise on CPU threads. The gather form needs no synchronisation and is identical across all backends.
- Inner loop per particle `i`:
  1. Locate `i`'s cell; iterate the 3×3 neighbourhood (with boundary handling per 3.5).
  2. For each candidate `j ≠ i` in those cells: `dx = posX[j]-posX[i]`, `dy = posY[j]-posY[i]`, `d2 = dx*dx + dy*dy`.
  3. **Early reject on squared distance**: skip if `d2 > rMax²` or `d2 < ε` (ε ≈ 1e-12, guards divide-by-zero for coincident particles). `sqrt` MUST only run for survivors — it is the expensive operation.
  4. `d = sqrt(d2)`; `f = forceMag(d / rMax, rel[type[i]*K_MAX + type[j]])`; accumulate `acc += (dx/d, dy/d) * f`.
- Note the relationship lookup is a pure array index — no branching on type pairs. This is the "matrix thinking" payoff: the inner loop is branch-light and SIMD/GPU-friendly.

### 3.3 Force function (canonical particle-life shape)
- Inputs: normalised distance `r = d/rMax ∈ (0,1]`, relationship coefficient `a ∈ [-1,1]`, close-range repulsion radius `beta ∈ (0,1)` (typical 0.3).
- Definition:
  - if `r < beta`: return `r/beta − 1` (universal repulsion, ranges −1→0; prevents collapse regardless of `a`)
  - else: return `a * (1 − |2r − 1 − beta| / (1 − beta))` (triangle peaking at the midpoint of `[beta, 1]`, zero at both ends)
- Output is multiplied by a global `forceScale` (and typically by `rMax`) when applied. The function MUST be identical across backends so the validation oracle (Section 10) is meaningful.
- This exact function is a default, not sacred — but any replacement MUST be C0-continuous, zero at `r = 1` (no popping at the cutoff), and repulsive as `r → 0`.

### 3.4 Integration
- Semi-implicit Euler is sufficient and SHOULD be the default: `vel = vel*friction + acc*dt; pos += vel*dt`.
- Friction SHOULD be expressed frame-rate-independently, e.g. via half-life: `friction = pow(0.5, dt / frictionHalfLife)`.
- Integration MUST be a separate pass/dispatch from force computation (this is free on CPU and **required** on GPU — see 7.4 on read/write hazards).

### 3.5 Boundary policy
Support at least one; make it a `boundaryMode` param:
- **Wrap (toroidal)** — the usual choice for particle life. Two consequences that MUST both be handled:
  1. The 3×3 neighbourhood wraps: cell coordinates are taken modulo `gridW/gridH` (use a proper positive modulo).
  2. Distance uses the **minimum-image convention**: if `|dx| > worldW/2`, correct by `±worldW` (same for dy) *before* computing `d2`. Forgetting this makes forces ignore the seam and particles pile up at edges.
- **Bounce** — clamp position to bounds and negate the corresponding velocity component; the 3×3 loop simply skips out-of-range cells.
- Wrap-around is the most common source of subtle bugs; include seam behaviour in the test plan.

### 3.6 Determinism notes
- CPU single-thread: fully deterministic given a seed. CPU multi-thread: deterministic if each thread owns a fixed particle range and grid build merges per-thread histograms in fixed order.
- GPU: accumulation order within the gather loop is deterministic per particle, but grid `sorted[]` ordering from atomics is not; float results may also differ slightly across vendors. Treat GPU as **statistically equivalent**, not bit-identical — validate with tolerances (Section 10), and rely on the CPU path when exact reproducibility is required.

---

## 4. Performance doctrine

### 4.1 Cost model
- Frame cost ≈ `n × E[neighbours within 3×3]` force evaluations + O(n) grid build + O(n) integrate + render. **Density matters as much as count**: doubling `rMax` roughly quadruples in-range neighbours; doubling n at fixed world size doubles both n and density (≈4× work). Expose `rMax` and world size as first-class performance levers.
- Rendering and buffer uploads are NOT the bottleneck once Section 5 is followed: 100k particles × 2 floats × 4 bytes = 800 KB/frame upload is trivial; even 1M (8 MB/frame) is acceptable, though the GPU-resident path eliminates it anyway.

### 4.2 Approximate capacity per stage (orientation, not promises; assumes moderate density, modern hardware)
- Plain JS, typed arrays, grid: ~10–20k @ 60fps
- - + Worker/SAB (decouples render): similar sim rate, smoother presentation
- WASM scalar: ~1.5–3× JS. WASM + SIMD: 2–4× more on the inner loop. WASM + SIMD + 4 threads: ~100–250k
- WebGPU compute (fully resident): ~500k–1M+
- Decision rule: if the ceiling target is ≤ ~200k, the WASM path is legitimate and easier to debug. If the target is "as many as possible", **skip WASM** and go JS → WebGPU; the two skill trees (SIMD intrinsics vs WGSL/bind groups/parallel scan) do not transfer into each other.

### 4.3 Hot-loop rules (all backends)
- Squared-distance reject before sqrt; no divisions where a multiply by reciprocal works; hoist invariants (`rMax²`, `type[i]*K_MAX`, particle i's position) out of the inner loop.
- Sequential access patterns; no per-frame allocation; no megamorphic call sites in JS (keep the inner loop monomorphic, ideally in one function operating only on typed arrays).
- Measure before optimising further: with rendering fixed (Section 5), expect the force pass to be ~90% of frame time; that is where all further effort goes.

---

## 5. Rendering architecture

### 5.1 The anti-pattern to eliminate (current Pixi path)
The path `sim typed arrays → loop writing particle.x/y on n Pixi particle objects → Pixi re-packs those objects into its internal Float32Array → GPU upload → draw` contains two full O(n) traversals (your sync loop + Pixi's pack loop) whose only effect is converting typed arrays into a typed array. ParticleContainer's particles are lighter than Sprites but are still per-particle JS objects. At 6-digit counts this layer MUST be deleted, not optimised.

### 5.2 Stage R1 — direct buffer feed (keep Pixi as host)
- Replace ParticleContainer with a custom instanced geometry + shader:
  - **Per-instance position attribute**: a single interleaved `Float32Array` `[x0,y0,x1,y1,…]`, flagged dynamic, updated once per frame. Ideally the sim's integrate pass writes **directly into this array** so no sync step exists at all — the sim output buffer IS the render attribute source.
  - **Per-instance type attribute**: uploaded **once**, flagged static (it only changes if types are re-rolled). Colour is derived from it in the shader (Section 8.3).
  - **Base geometry**: a unit quad (4 verts or a single oversized triangle), instanced n times; the vertex shader translates/scales it per instance.
- Portability caveat: WebGL supports `gl.POINTS` with `gl_PointSize`, but **WebGPU's point primitive is fixed at 1 pixel** — instanced quads are the portable choice and also enable velocity-stretching (8.4).
- Verify exact attribute/buffer APIs against current Pixi v8 documentation; the pattern (custom Geometry + Buffer + instanced Shader/Mesh) is standard, the method names move.
- Exit state: per frame the renderer performs one buffer update and one instanced draw call; render cost is flat; ~100% of frame time belongs to the sim.

### 5.3 Stage R2 — native WebGPU renderer (endgame)
- Once the simulation lives in WebGPU compute (Section 7), Pixi stops adding value for the particle layer: its renderer cannot cheaply consume a `GPUBuffer` it does not own, and fighting that abstraction is fragile. Replace the particle layer with a raw WebGPU canvas: a render pipeline whose vertex stage reads the **same position/velocity/type storage buffers the compute passes write** — positions never return to JS.
- Camera (pan/zoom) is a small uniform: a 3×3 matrix or a `vec4(offsetXY, scaleXY)` mapping world→clip space in the vertex shader. (This is where literal transformation matrices finally enter the project.)
- UI layering: DOM/HTML controls overlaid on the canvas; optionally keep a transparent Pixi canvas stacked above for rich 2D chrome. Pixi for UI, raw WebGPU for the particle firehose.

---

## 6. Threading and the optional WASM stage

### 6.1 Worker + SharedArrayBuffer (do this regardless of WASM)
- Move the simulation into a Web Worker with particle state in a `SharedArrayBuffer`. Requires serving **COOP/COEP cross-origin-isolation headers** — set this up early; it is a deploy-environment task, not a code task.
- Main thread per frame: read positions from the SAB region → update GPU attribute buffer → draw. Sim hitches no longer drop render frames.
- SHOULD support sim/render rate decoupling: store previous + current positions, interpolate in the vertex shader with a single uniform `t` (lerp costs nothing). A 30 Hz sim then presents at 60/120fps smoothly.

### 6.2 WASM (optional path; see decision rule 4.2)
- Mental model: the WASM module owns one linear-memory `ArrayBuffer`; your typed arrays become **views into it**. JS and WASM read/write the same bytes — zero copy, no marshalling.
- Gains: ~1.5–3× from compiled scalar code; **SIMD128 is the real win** — `f32x4` lanes compute four `dx² + dy²` and four range-compares per instruction, possible only because data is SoA. Threads (workers + shared memory) parallelise the force pass trivially (read-only on positions, each thread owns a particle range); grid build uses per-thread histograms merged in fixed order, or integer atomics.
- Rules: exactly one boundary crossing per frame (`step(dt)`); never call WASM per particle. Toolchain: Rust + wasm-pack (smoothest), C/C++ + Emscripten, AssemblyScript (TS-like, weaker SIMD ergonomics).
- Keep the algorithm byte-identical to the JS reference so the oracle (Section 10) applies bit-exactly in single-thread mode.

---

## 7. WebGPU compute stage

### 7.1 Execution model in one paragraph
A compute shader (WGSL) runs once per invocation; invocations are grouped into workgroups. Use `@workgroup_size(64)` and dispatch `ceil(n / 64)` workgroups; invocation `global_invocation_id.x = i` handles particle `i`, with a guard `if (i >= n) { return; }`. JS's frame role shrinks to recording command buffers: it issues dispatches and draws but touches no particle data.

### 7.2 Buffer inventory (all created once, K_MAX/N_MAX sized)
- `posA`, `posB` (`array<vec2f>`) — ping-pong pair, or `pos` + separate `acc` buffer with a two-pass scheme
- `vel` (`array<vec2f>`), `type` (`array<u32>`)
- `rel` (`array<f32>`, length K_MAX², **storage** buffer — storage avoids uniform-size limits and supports arbitrary K)
- `cellCount` (`array<atomic<u32>>`), `cellStart` (`array<u32>`), `cursor` (`array<atomic<u32>>`), `sorted` (`array<u32>`)
- `params` (uniform struct: n, K, gridW, gridH, cellSize, rMax, dt, friction, beta, forceScale, world dims, boundaryMode, time)
- Optional: `palette` (`array<vec4f>`), `neighbourCount` (`array<u32>`) for density effects, `posPrev` for interpolation
- WGSL layout notes: `vec2f` aligns to 8 bytes; prefer `vec2f`/`vec4f` fields and check struct alignment rules rather than assuming C layout. Atomics exist only for `u32`/`i32` — never needed for floats here because of the gather formulation.

### 7.3 Frame command order (one encoder, implicit barriers between dispatches)
1. clear `cellCount`/`cursor` (small dispatch or `clearBuffer`)
2. **histogram**: each particle `atomicAdd(cellCount[cell], 1)` and records `cellOf`
3. **prefix sum** over `cellCount` → `cellStart` (parallel scan — see 7.5)
4. **scatter**: `slot = atomicAdd(cursor[cell], 1)`; `sorted[cellStart[cell] + slot] = i`
5. **forces**: gather loop per particle (transliteration of 3.2), reading `posIn`, writing `acc` (or directly `velOut`)
6. **integrate**: writes `posOut`/`vel`; swap ping-pong buffers for next frame
7. **render pass**: instanced draw reading `posOut` + `type` (+ `vel`, `neighbourCount` for effects)

### 7.4 Hazards and rules
- MUST NOT read and write the same positions buffer within one pass — invocation order is undefined, so particle `i` could read a half-updated `j`. Ping-pong buffers or a forces-then-integrate split (each dispatch is a global barrier) solves it; multi-pass is the GPU norm.
- MUST NOT read GPU data back to the CPU in the hot loop — readback is slow and asynchronous; reserve it for debugging. The render pass consuming compute output in place is the entire point.
- `rel` and `params` updates are tiny `queue.writeBuffer` calls, legal every frame (e.g. while a slider drags).

### 7.5 The hard 20%: GPU grid build
- Histogram and scatter are direct (integer atomics). The **prefix sum** is the one genuinely "GPU-brained" algorithm: implement a standard workgroup-level scan (e.g. Blelloch) with a second pass adding workgroup block sums, sized for `numCells`. It is a well-documented classic; budget real time for it and test it standalone against a CPU scan over random inputs.
- Sanctioned interim (Stage 3b): build the grid on the **CPU** each frame and upload `cellStart` + `sorted` (`(numCells + n) × 4` bytes). Gets force/integrate kernels working and validated first; viable to roughly ~50k particles before upload+CPU build costs argue for finishing the GPU build.

---

## 8. Product feature specifications

### 8.1 Live relationship editing
- Data path: UI writes into the CPU-side `rel` Float32Array (and `params`), then per backend: CPU sim reads it directly next tick; worker sim reads it from the SAB (or receives it via postMessage); GPU gets `queue.writeBuffer(relBuf, …)` — 16 KB, negligible, may be sent on every input event.
- **Torn-write tolerance**: entries are independent scalars, so a tick that sees a half-updated matrix is visually harmless. No locking required. Do not add synchronisation complexity here.
- Randomisation MUST use a **seeded PRNG** (e.g. mulberry32). Provide at minimum: full re-roll (uniform in [-1,1]), symmetric re-roll (mirror upper triangle), per-row/per-type re-roll. Asymmetric vs symmetric matrices produce categorically different behaviours (chasing vs clumping) — expose both.
- Shareability (SHOULD): encode `{seed, K, rMax, friction, beta, forceScale, n}` in the URL so any interesting ecosystem is a link. Matrix itself need not be encoded if it derives from the seed; if hand-edited, fall back to encoding the matrix (K² small floats, base64).
- Editor UI: K ≤ ~10 → grid of sliders/steppers; larger K → a canvas-rendered K×K heatmap with click/drag-to-adjust (DOM does not scale to K² elements, one canvas does). Colour the heatmap with a diverging scale (negative ↔ positive).

### 8.2 Arbitrary K at runtime
- Thanks to the `K_MAX` stride (2.2), changing K touches exactly three things: fill new rel rows/columns (re-randomise), write the new `K` into params, and — only when K **shrinks** — remap or re-roll particle types `≥ K` (one O(n) pass, then re-upload the type attribute).
- `type` values MUST always satisfy `type[i] < K`; enforce at every K change and at spawn.

### 8.3 Automatic type colours
- Colours are **derived, not stored**. Default: golden-angle hue stepping, `hue_i = (i × 137.508°) mod 360` with fixed saturation/lightness — type `i` keeps its colour forever as K grows (better than `i/K × 360`, which reshuffles every colour when K changes).
- Preferred implementation: compute colour **in the vertex/fragment shader** from the type index (HSV→RGB is ~5 lines of shader code) — zero uploads, zero state, works for any K.
- Alternative (only if per-type user customisation becomes a feature): a small `array<vec4f>` palette buffer indexed by type; re-upload on change. Refinement for polish: generate perceptually-even colours (OKLCH) on the CPU into this buffer instead of raw HSL.

### 8.4 Prettifying effects (all render-layer-only — MUST NOT touch the sim)
Ordered by payoff-per-effort:
1. **Soft sprites + additive blending**: fragment shader alpha = `1 − smoothstep(…)` on radial distance from quad centre (no texture needed); additive blend over a dark background. Overlaps sum into bright cores with halos — this single change is ~80% of the "pretty particle video" look. Available in the Pixi stage too (additive blend + radial-falloff texture).
2. **Persistence trails**: render into a texture that survives between frames; each frame draw a translucent black full-screen quad (fade factor ~0.05–0.15, expose as a slider) to dim history, then particles additively, then blit to the canvas. Requires owning the render pass (`loadOp: 'load'`, not `'clear'`).
3. **Velocity-driven rendering**: vertex shader reads the `vel` buffer (already on GPU): stretch the instanced quad along `normalize(vel)` scaled by speed (motion streaks) and/or scale brightness by speed. Zero new data.
4. **Density-driven rendering**: the force kernel already iterates in-range neighbours — increment a counter and write `neighbourCount[i]`; render modulates size/brightness by crowding. Essentially free.
5. **True bloom** (downsample → blur → composite chain): real work; defer until everything else ships — item 1 approximates the look.

---

## 9. Migration roadmap with exit criteria

Each stage ships a working build. The data model (Section 2) is untouched throughout.

**Stage 0 — JS reference implementation (the oracle).** Grid (counting sort), gather forces, integrate, boundary handling, seeded init. Kept forever as the correctness oracle, never deleted. *Exit: deterministic given a seed; visually exhibits known particle-life behaviours (clusters, chasers); handles ~10–20k @ 60fps.*

**Stage 1 — direct buffer feed rendering (5.2).** Delete the object sync; sim writes the interleaved render array; type/colour static or shader-derived. *Exit: render+sync cost < ~1 ms at 100k instances drawn (sim may still be the limit); zero per-frame allocation in render path.*

**Stage 2 — worker + SAB (6.1).** COOP/COEP deployed; sim off main thread; optional interpolation. *Exit: artificially stalling the sim does not drop presentation frames; main-thread frame work is read-SAB + upload + draw only.*

**Stage 3a (optional, only if target ≤ ~200k) — WASM SIMD in the worker (6.2).** *Exit: bit-identical to Stage 0 single-threaded; ≥3× sim throughput; one boundary crossing per frame.*

**Stage 3b — WebGPU forces + integrate, CPU grid upload (7.5 interim).** *Exit: GPU output matches oracle within tolerance (Section 10); ping-pong/two-pass hazard handling verified; works to ~50k with uploaded grid.*

**Stage 4 — GPU grid build (7.5).** Histogram, parallel scan, scatter as dispatches; scan unit-tested standalone. *Exit: no per-frame particle-data uploads remain; 200k+ stable.*

**Stage 5 — native WebGPU renderer (5.3); remove Pixi from the particle layer.** Effects 8.4 items 1–4; camera uniform; DOM UI overlay. *Exit: positions never leave the GPU; 500k+ at 60fps on target hardware; trails + additive glow shipping.*

---

## 10. Validation and instrumentation

- **Oracle comparison**: run Stage 0 and the backend under test from the same seed for T ticks; compare positions. CPU/WASM single-thread: expect bit-exact. GPU/multithread: expect statistical equivalence — compare aggregate metrics (mean displacement, kinetic energy, cluster counts via the grid) within tolerance, plus short-horizon per-particle drift bounds. Define tolerances before porting, not after.
- **Unit tests** (cheap, high value): prefix sum vs CPU scan on random inputs; grid completeness (brute-force O(n²) neighbour list vs grid neighbour list on small n — MUST be a superset of in-range pairs); minimum-image distances across the wrap seam; force function shape (zero at r=1, negative below beta, sign follows `a`).
- **Sanity invariants** at runtime (debug builds): no NaNs in pos/vel (NaN propagates virally — check after integrate), velocities under a speed cap, `Σ cellCount == n` after histogram.
- **Performance instrumentation**: per-phase CPU timings; GPU timestamp queries per dispatch when available; on-screen counters for n, sim Hz, render fps, avg neighbours per particle (the density lever). Profile before optimising; expect forces ≈ 90% of frame once Section 5 is done.

---

## 11. Pitfalls checklist (things that will otherwise cost a debugging day)

- [ ] Allocation inside the frame loop (closures, array literals, `push`) → GC stutter
- [ ] `sqrt` before the squared-distance reject; missing `d2 < ε` guard → NaN explosion from coincident particles
- [ ] Wrap mode without minimum-image distances, or 3×3 neighbourhood not wrapping modulo grid size → edge artefacts
- [ ] JS `|0` floor trick is only valid for non-negative values in range — positions can go negative before boundary handling
- [ ] Scatter force formulation on GPU (no float atomics) — must be gather
- [ ] Reading and writing the same position buffer in one GPU pass — undefined results, often "almost works"
- [ ] WebGPU point-list primitives are 1px — use instanced quads
- [ ] Uniform buffer size limits with large K — use a storage buffer for `rel`
- [ ] Forgetting COOP/COEP headers → SharedArrayBuffer silently unavailable
- [ ] Per-particle Pixi object layer reintroduced "temporarily" → double O(n) copy returns
- [ ] GPU readback in the frame loop "just to debug" left enabled → mysterious frame pacing
- [ ] Type values ≥ K after shrinking K → out-of-bounds rel reads (clamp/remap on K change)
- [ ] Comparing GPU to oracle expecting bit-exactness → false alarm; use tolerances
- [ ] Tuning while measuring with DevTools open / power-saver GPU profile → misleading numbers

---

## 12. Glossary

- **SoA (Structure of Arrays)**: one flat array per field (`posX[]`, `posY[]`) instead of an array of objects. Enables cache-friendly loops, SIMD, and GPU buffers.
- **Vectorisation**: expressing work as uniform operations over contiguous arrays so hardware (SIMD lanes, GPU invocations) processes many elements per instruction.
- **Gather vs scatter**: gather = each output element reads many inputs (no write conflicts); scatter = each input writes many outputs (needs atomics). Always gather here.
- **Counting sort / prefix sum (scan)**: histogram + running-total offsets + scatter; the allocation-free way to group particles by cell. The scan is the parallel running total.
- **Ping-pong buffers**: two buffers alternating read/write roles each frame to avoid read-write hazards in parallel passes.
- **Instanced rendering**: drawing one base mesh n times with per-instance attributes (position, type) in one draw call.
- **Workgroup / invocation**: GPU execution units; a dispatch launches many workgroups, each running `workgroup_size` invocations of the kernel.
- **Storage vs uniform buffer**: storage = large, read/write, arbitrary length; uniform = small, read-only, fastest for tiny structs (params). `rel` → storage; `params` → uniform.
- **Minimum-image convention**: in a wrapping world, measure pair distance via the shorter route across the seam.
- **Linear memory (WASM)**: the single ArrayBuffer a WASM module owns; JS typed-array views over it give zero-copy sharing.
- **COOP/COEP**: HTTP headers enabling cross-origin isolation, required for SharedArrayBuffer (and thus WASM threads).
- **Golden-angle hues**: `hue_i = (i × 137.508°) mod 360` — maximally spread, order-stable colour assignment for arbitrary K.
