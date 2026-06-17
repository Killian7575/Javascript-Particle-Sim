# Correctness Oracle — Validation Guidance & Checklist

Companion to the *Particle Life Engine — Architecture & Implementation Guide*. That document's Section 10 names the validation strategy; this document specifies it fully: how to build the oracle, how to compare each backend against it, which invariants are valid (and which are tempting but wrong), concrete test procedures, and a debugging playbook for when comparisons fail. Like the main guide, this is **guidance for a human or LLM implementer — not an implementation**. Pseudocode appears only where an exact formula or contract matters.

---

## 0. Purpose and principles

- The **oracle** is the Stage 0 single-threaded JavaScript reference implementation. Its job is to be *obviously correct*, not fast. It is the ground truth that every later backend (worker, WASM, WebGPU) is measured against. It MUST never be deleted and MUST NOT be optimised in ways that reduce clarity.
- The core difficulty this document manages: the simulation is **chaotic** (tiny differences grow exponentially) and **floating-point order-sensitive** (changing summation order changes the last bits). Therefore "is the port correct?" cannot always mean "are the numbers identical?" — it means "identical where identity is achievable, statistically equivalent where it is not, with the equivalence class chosen *before* porting" (Section 3).
- Secondary difficulty: the oracle itself can be wrong. It is therefore validated first against an even simpler implementation (Section 2) and against hand-derivable cases before anything is validated against *it*.

---

## 1. Oracle design requirements

### 1.1 Determinism
- MUST be single-threaded with a fixed, documented iteration order: particles in ascending index order; the 3×3 neighbourhood in a fixed (e.g. row-major, offsets −1→+1) order; particles within a cell in `sorted[]` order. This defines the **canonical accumulation order** for force sums.
- MUST use a seeded PRNG (e.g. mulberry32) for *everything* random: initial positions, types, and matrix generation. `Math.random()` MUST NOT appear anywhere in the oracle. Same seed + params + tick count → bit-identical state, always.
- SHOULD generate initial state in exactly one place (the oracle's generator) and deliver it to other backends via snapshot loading (Section 6), so backends never need a matching PRNG port — this removes an entire category of false mismatches.

### 1.2 Numeric representation
- State MUST be stored in `Float32Array`s, with intermediate values written back through f32 storage at the same points the backends will round (JS computes in f64 internally; storing to a Float32Array element rounds to f32). This makes single-threaded WASM f32 output achievable as bit-exact.
- SHOULD additionally support a **float64 twin** mode (same code, Float64Array storage). The f32-vs-f64 divergence of the oracle against itself measures the *inherent floating-point noise floor* of the system — the yardstick tolerances are derived from (Section 8).

### 1.3 Headless contract
- The oracle MUST run without any renderer (Node or headless browser), exposing roughly: `init(seedOrSnapshot, params) → state`, `step(state, ticks)`, `snapshot(state) → bytes`, `hash(state) → string`, `metrics(state) → {…}` (Section 4.3). This is what CI and the comparison harness drive.
- The hash SHOULD be a digest over the concatenated raw bytes of `pos/vel/type` plus params — a one-line equality check for the bit-exact classes.

### 1.4 Scope identity
- Force function, integration scheme, friction formulation, boundary handling (including minimum-image distances in wrap mode), `K_MAX` stride indexing of `rel`, and the ε guard MUST match the main guide's Section 3 exactly. Any change to the algorithm is made in the oracle *first*, then propagated.

---

## 2. Validating the oracle itself (Tier A)

The grid-based oracle is only trustworthy once checked against things simpler than itself:

- **Brute-force twin**: an O(n²) all-pairs implementation (no grid) sharing the force function and integrator. For small n (≈100–2,000), several seeds, and **both boundary modes**, compare against the grid oracle:
  - The set of interacting pairs (those passing the `d2 ≤ rMax²` filter) MUST be *identical* as a set.
  - Accumulated forces may differ in the last bits because the grid visits neighbours in a different order than index order — compare within a tiny epsilon (a few ULPs scaled by the number of neighbours), or sort each particle's contribution list canonically before summing in both implementations to get bit-exactness.
- **Two-particle analytic case**: place exactly two particles at a chosen distance `d` with known types and a hand-set `rel`. The expected acceleration is computable by hand from the force function definition (one triangle-function evaluation, one unit vector). Check both directions with an asymmetric matrix — this single test exercises the `rel[a*K_MAX+b]` ordering, the unit-vector math, and the sign conventions, which are the three most common transcription errors.
- **Edge placements**: particles straddling the wrap seam (one near x=0, one near x=worldW) MUST attract/repel across the seam, not across the interior. Include the corner case (wrapping in both axes simultaneously).
- Only after Tier A passes is the grid oracle promoted to ground truth.

---

## 3. Equivalence classes — decide before porting

Every backend comparison belongs to exactly one class. Misclassifying causes either false alarms or false confidence.

### Class 1 — bit-exact
- **Applies to**: worker-hosted JS (same code, different thread); single-threaded scalar WASM f32.
- **Expectation**: `hash(backend) === hash(oracle)` after any number of ticks.
- **Preconditions**: identical iteration order; WASM compiled **without** fast-math / unsafe-math flags and without FMA contraction (these reassociate or fuse operations and break the last bits); same f32 rounding points as 1.2. IEEE basic ops (+, −, ×, ÷, sqrt) are correctly rounded on both sides, so exactness is genuinely achievable here.
- If Class 1 fails, it is a real bug or a build-flag problem — never "just floats". Do not loosen to tolerances; find it.

### Class 2 — order-perturbed, same precision
- **Applies to**: multithreaded WASM (per-thread grid histograms change `sorted[]` order → accumulation order changes); SIMD lane-sum reassociation.
- **Expectation**: per-tick differences at the floating-point noise floor that **grow exponentially** with ticks (chaos). Valid comparisons: short-horizon trajectory bounds (Section 4.1) and long-horizon statistical aggregates (Section 4.2). Hash equality is NOT expected.

### Class 3 — different hardware/compiler
- **Applies to**: WebGPU (and any GPU backend). Sources of divergence: nondeterministic `sorted[]` ordering from atomics, possible FMA contraction in shader compilation, and GPU `sqrt`/transcendental precision being ULP-bounded by the spec rather than exactly rounded — all legitimate, none indicating bugs.
- **Expectation**: same protocol as Class 2, generally with slightly looser short-horizon bounds (derive empirically, Section 8). Additionally, *vendor-to-vendor* differences exist: golden numbers recorded on one GPU will not reproduce exactly on another — record golden **metrics with tolerances**, not golden states.

---

## 4. Comparison methodology

### 4.1 Short-horizon trajectory test (Classes 2–3)
- Load the identical snapshot into oracle and backend; run a small T (1, then 10 ticks); compare per-particle positions.
- Metrics (normalise by `rMax` so they are scale-free):
  - `maxErr = max_i |p_backend(i) − p_oracle(i)| / rMax`
  - `rmsErr = sqrt(mean_i |Δp_i|²) / rMax`
  - In wrap mode, `Δp` MUST itself use minimum-image distance, or seam-adjacent particles produce phantom errors of ~worldW.
- T=1 isolates a single force+integrate evaluation (with shared grid input where possible — see Stage 3b gate, Section 7) and is the most diagnostic single number in the whole methodology.
- Measure the empirical **divergence doubling time** by plotting `rmsErr(T)` for T = 1…100 on a known-good build: this tells you the horizon beyond which per-particle comparison is meaningless and only Section 4.2 applies.

### 4.2 Long-horizon statistical equivalence (Classes 2–3)
Run both implementations for a long T (thousands of ticks) from the same snapshot and compare aggregates. Valid aggregates:
- **Kinetic energy** time series, `KE = ½ Σ |v_i|²` — the system is driven-and-damped, so KE settles into a statistical steady-state band; compare band mean and spread, not instantaneous values.
- **Neighbour-count distribution**: histogram of per-particle in-range neighbour counts (cheap — the force pass already counts). This is a robust structural fingerprint: clustering vs gas-like states produce very different histograms. Compare with an L1/chi-square distance threshold.
- **Occupied-cell count / cell-occupancy histogram** from the grid — a crude but free clustering measure.
- **Type-conditional statistics** (mean speed per type, neighbour counts per type pair) when behaviours like chasing are type-specific.

### 4.3 Invalid invariants — do NOT assert these
- **Energy conservation**: false; the system has external driving (the force rule) and damping (friction). KE is steady-state, not conserved.
- **Momentum conservation**: false in general. With an asymmetric matrix, particle i's pull on j and j's on i use *different* coefficients — Newton's third law deliberately does not hold (this is what makes chasing possible). Momentum is conserved only in the special case of a symmetric matrix with zero friction; do not build a check that assumes it.

### 4.4 Valid runtime invariants (assert in debug builds, all backends)
- No NaN/Inf in pos/vel — check after integrate; NaN propagates virally, and first-NaN tick is a key debugging datum (Section 9).
- Positions within world bounds after boundary handling.
- Speeds under the analytic cap implied by friction: with per-tick damping `f` and max force magnitude `F`, terminal speed is bounded by `F·dt/(1−f)` (plus margin).
- After grid build: `Σ cellCount == n`; `cellStart` monotonic non-decreasing; `sorted` is a permutation of `0…n−1`.
- Type histogram constant across ticks (types never mutate during simulation); `type[i] < K` always.

### 4.5 Behavioural fingerprints (human-level regression)
- Maintain a small set of **canonical seeds** with documented qualitative outcomes ("seed 42, K=4, preset matrix M1 → stable multi-type cell-like clusters by tick 2000"; "seed 7, asymmetric M2 → chaser pairs"). After any change, eyeball these. Cheap, catches whole-sign and whole-axis errors that numeric noise analysis can rationalise away.

---

## 5. Unit-test checklist (component level)

Implement these as small, fast, headless tests; they run on every change, before any oracle comparison.

**Force function**
- [ ] `f(r, a) = 0` at `r = 1` exactly, for all `a` (no popping at the cutoff)
- [ ] `f(beta, a) = 0` for all `a` (continuity at the repulsion boundary)
- [ ] `f(r, a) → −1` as `r → 0` (universal close repulsion, independent of `a`)
- [ ] sign of `f` equals sign of `a` for `r ∈ (beta, 1)`; peak located at `r = (1+beta)/2`
- [ ] `f(r, 0) = 0` for `r ≥ beta`

**Grid / counting sort**
- [ ] brute-force in-range pair set == grid-derived in-range pair set (multiple seeds, n ≤ 2k, both boundary modes)
- [ ] every particle's `cellOf` matches recomputation from its position; out-of-world positions impossible post-boundary
- [ ] `Σ cellCount == n`; `sorted` is a permutation; `cellStart[numCells] == n`
- [ ] cell indexing correct on the last row/column (off-by-one on `gridW/gridH` with non-divisible world sizes)

**Prefix sum (standalone, before GPU port and again on GPU)**
- [ ] matches a serial CPU scan on random inputs; lengths: 1, workgroup size, non-power-of-two, multi-block sizes; all-zeros; single-nonzero

**Boundary / minimum image**
- [ ] wrap: positions remain in `[0, worldW) × [0, worldH)`; min-image distance symmetric, `d(i,j) = d(j,i)`; seam pair measures the short way; both-axes corner wrap correct
- [ ] bounce: position clamped, corresponding velocity component negated, tangential component untouched

**Integration**
- [ ] with zero forces, speed halves after exactly `frictionHalfLife` of simulated time (validates the rate-independent friction formulation)
- [ ] `dt` halving + tick doubling yields approximately the same trajectory over short horizons (integrator sanity, tolerance-based)

**Relationship matrix / K**
- [ ] asymmetric lookup: with `rel[a→b] ≠ rel[b→a]` set by hand, the two-particle case produces the two different expected magnitudes
- [ ] `K_MAX` stride indexing verified for a > 0 and b > 0 (catches `a*K + b` vs `a*K_MAX + b` transcription)
- [ ] shrinking K remaps/re-rolls all `type[i] ≥ K`; no out-of-bounds `rel` reads possible afterwards

**Determinism**
- [ ] same seed, two fresh runs, T ticks → identical hashes (oracle, and every Class 1 backend)

---

## 6. Snapshot and replay protocol

Comparisons are only meaningful if every backend can be fed *exactly* the same starting state and report state in a common format.

### 6.1 Snapshot format (versioned)
- One container holding: `{ formatVersion, tick, seed, params (full struct incl. K, K_MAX, rMax, dt, friction, beta, forceScale, world dims, boundaryMode), rel (K_MAX² f32), posX/posY/velX/velY (f32), type (u32) }`.
- Practical encoding: JSON header + binary (or base64) array payloads. The arrays MUST round-trip bit-exactly — re-serialising a loaded snapshot yields identical bytes.
- Every backend implements exactly two operations against it: `loadSnapshot(bytes)` and `dumpSnapshot() → bytes`. With these, the harness is backend-agnostic.

### 6.2 Replay harness contract
- `run(snapshotIn, T, backendName) → { snapshotOut, hash, metrics, perPhaseTimings }` — headless, scriptable, identical CLI/API across backends. This is the single tool every gate in Section 7 uses.

### 6.3 Canonical test corpus (small, version-controlled)
- **pair-analytic**: n=2, hand-set distance/types/matrix; expected accelerations derivable by hand (Section 2). Both an attracting and a repelling configuration, and the asymmetric A→B vs B→A pair.
- **trio-chase**: n=3 with a rock-paper-scissors asymmetric matrix; qualitative outcome: perpetual pursuit (momentum visibly not conserved — doubles as a reminder of Section 4.3).
- **seam-suite**: ~50 particles initialised near edges and corners in wrap mode; exercises min-image and neighbourhood wrapping.
- **uniform-1k**: n=1,000, uniform scatter, moderate density — the workhorse for Tier A and trajectory tests.
- **dense-cluster**: high local density (many neighbours per particle) — stresses accumulation-order sensitivity and the ε guard.
- **steady-state-10k**: n=10,000 run to statistical steady state; source of golden *metrics with tolerances* (KE band, neighbour-count histogram) for Section 4.2.
- Each corpus entry stores: the snapshot, the qualitative expectation in prose, and recorded golden metrics (with the hardware/build they were recorded on).

---

## 7. Per-stage validation gates

Each roadmap stage from the main guide passes its gate before the next begins. All gates are run via the Section 6.2 harness on the corpus.

**Stage 0 (oracle)** — Tier A brute-force agreement; full Section 5 unit suite green; determinism hash test; behavioural fingerprints recorded for canonical seeds; f64-twin noise floor measured and written down (Section 8).

**Stage 1 (direct buffer rendering)** — rendering MUST NOT perturb simulation: hash after T ticks identical with renderer attached vs headless. Visual spot-check against fingerprints (catches transposed x/y, flipped axes, type/colour misindexing that numeric checks cannot see).

**Stage 2 (worker + SAB)** — Class 1: bit-exact hashes vs Stage 0. Additionally a **tear test**: hammer `rel` writes from the UI thread mid-tick for thousands of ticks; assert no NaN/Inf, no crash, no invariant violations (per design, torn matrices are benign — prove it).

**Stage 3a (WASM, if taken)** — single-thread scalar: Class 1 bit-exact (build flags per 3.1; if it fails, suspect fast-math/FMA flags before suspecting code). SIMD and multithread variants: Class 2 protocol — T=1 and T=10 trajectory bounds within tolerance, long-horizon aggregates within golden bands.

**Stage 3b (GPU forces+integrate, CPU grid)** — the sharpest test available: feed the GPU the *oracle's own* `cellStart`/`sorted` for one tick and compare `acc` (or post-integrate positions) directly — this isolates the force kernel from grid differences entirely. Class 3 tolerances at T=1; then T=10 trajectory; then long-horizon aggregates.

**Stage 4 (GPU grid build)** — prefix-sum standalone test on-device; then grid-output equivalence for identical positions: `cellStart` arrays MUST match exactly; `sorted` MUST match **as a multiset per cell** (atomic scatter order within a cell is nondeterministic and irrelevant). Then re-run the full Stage 3b comparisons end-to-end.

**Stage 5 (native renderer + effects)** — sim hashes/aggregates unaffected by: renderer on/off, every effect toggled on/off (effects are render-layer-only by spec — this gate enforces it), camera pan/zoom (a uniform must not touch sim state).

---

## 8. Deriving tolerances (method, not magic numbers)

Hard-coded tolerances copied from elsewhere cause both false alarms and silent rot. Derive yours:

1. **Measure the noise floor**: run the oracle f32 vs its f64 twin on `uniform-1k` for T = 1 and T = 10; record `maxErr`/`rmsErr` (Section 4.1). This is the irreducible floating-point uncertainty of the system itself.
2. **Set short-horizon tolerances** as a small multiple (e.g. ~10×) of that floor for Class 2, somewhat larger for Class 3 — then **tighten empirically**: run the known-good backend 20–50 times (atomics make GPU runs vary), set the tolerance just above the observed max, and treat any future excursion as a regression.
3. **Set aggregate tolerances** from the oracle's own steady-state variability: run `steady-state-10k` from several seeds; the spread across seeds bounds how tightly any single metric can be expected to match. Backend bands must overlap oracle bands.
4. **Document every tolerance** next to the build/hardware it was derived on. A tolerance without provenance is a future false negative.
5. Re-derive after any change to the force function, integrator, dt, or density regime — tolerances are properties of the dynamics, not constants of the universe.

---

## 9. Debugging playbook — when a comparison fails

Work top-down; each step halves the search space.

1. **Classify first**: is this a Class 1 failure (hashes differ where exactness is expected)? Then it is a real bug or build flag — never floats; do not loosen tolerances. Class 2/3 failure? Continue.
2. **Bisect by phase** using the harness: compare after grid build only (`cellOf`, `cellStart`, per-cell multisets), after forces only (`acc`), after integrate (`pos/vel`). The first divergent phase owns the bug.
3. **Shrink the case**: rerun on `pair-analytic`, `trio-chase`, `seam-suite`. A force-kernel bug almost always reproduces at n=2 or n=3 with a hand-checkable expected value.
4. **First-bad-tick bisection**: binary-search the tick at which divergence exceeds threshold (or first NaN appears); snapshot one tick earlier and replay both backends single-tick under inspection.
5. **Symptom → culprit table**:
   - Errors only near world edges → minimum-image or neighbourhood wrap (the classic)
   - NaNs, density-correlated onset → missing/too-small `d2 < ε` guard (coincident particles)
   - "Almost right" with sporadic per-particle jitter on GPU → same-buffer read/write hazard (missing ping-pong / pass split)
   - Wrong only when `a` and `b` types differ → `K` vs `K_MAX` stride, or transposed `rel[a][b]`
   - First frame wrong, then self-heals → uninitialised buffer (acc/vel not cleared, or stale ping-pong side)
   - Correct at n small, wrong when a cell exceeds workgroup size or numCells exceeds one block → prefix-sum block-sum pass bug
   - Wrong only on last grid row/column → cell-count rounding (`ceil` vs `floor` on grid dims)
   - WASM differs in last bits only → fast-math/FMA build flags (Class 1 precondition)
   - Behaviour mirrored/rotated but coherent → x/y transposition in exactly one phase (often the renderer — check Stage 1 gate)
6. **GPU order-sensitivity probe**: temporarily dispatch with workgroup_size 1 (serialising much of the nondeterminism) — if the discrepancy collapses, it is accumulation-order noise (legitimate, retune tolerance); if it persists, it is a logic bug.
7. After the fix: add the failing configuration to the corpus as a regression case before moving on.

---

## 10. Automation / CI checklist

- [ ] Oracle + Tier A + full unit suite run headlessly on every commit (Node or headless browser); Class 1 hash tests included
- [ ] Corpus snapshots and golden metrics are version-controlled artefacts; changing them requires an explicit, reviewed update (with re-derivation notes per Section 8.4)
- [ ] GPU comparison job runs on at least one pinned hardware/browser configuration (Class 3 results are hardware-scoped — pin and document it)
- [ ] Per-phase timings from the harness logged over time; perf regressions surfaced even though this document is about correctness (a 10× slowdown is usually a correctness smell, e.g. a debug readback left enabled)
- [ ] NaN/invariant assertions enabled in CI builds, stripped from production builds

---

## 11. Master checklist (condensed)

**Build the oracle**
- [ ] Single-threaded, fixed iteration order, seeded PRNG only, f32 storage, headless API, snapshot + hash + metrics
- [ ] f64 twin available; noise floor measured and recorded

**Trust the oracle**
- [ ] Brute-force O(n²) agreement (pair sets exact; forces within ULP-scale epsilon or canonical-order bit-exact)
- [ ] Two-particle analytic checks incl. asymmetric matrix, both directions
- [ ] Seam/corner wrap cases pass; full unit suite (Section 5) green; determinism hash test green
- [ ] Behavioural fingerprints recorded for canonical seeds

**Per backend**
- [ ] Equivalence class declared before porting (1: bit-exact / 2: order-perturbed / 3: different hardware)
- [ ] Snapshot load/dump round-trips bit-exactly; harness contract implemented
- [ ] T=1 and T=10 trajectory comparison within derived tolerances (min-image-aware error metric)
- [ ] Long-horizon aggregates (KE band, neighbour-count histogram) within golden bands
- [ ] Stage gate from Section 7 passed and recorded
- [ ] Runtime invariants (4.4) asserted in debug; invalid invariants (4.3) nowhere asserted

**Stay correct**
- [ ] Every fixed bug becomes a corpus regression case
- [ ] Tolerances documented with provenance; re-derived when dynamics change
- [ ] CI runs the whole ladder on every change
