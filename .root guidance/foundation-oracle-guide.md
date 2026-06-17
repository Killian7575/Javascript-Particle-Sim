# Foundation Oracle — Pragmatic Day-One Validation

Supplement to the *Correctness Oracle* document. That document specifies the full apparatus needed across the whole roadmap; **this one specifies the minimal subset worth building immediately**, before any porting happens, with effort kept to roughly a day of total work. Nothing here is throwaway: the naive calculator built now *becomes* the full document's Tier A twin, and the grid sim it validates *becomes* the oracle. The full apparatus grows around this foundation later, triggered by specific events (Section 6).

Design constraint honoured throughout: **no manual derivation of expected values.** Trust is built instead from three pragmatic sources: *property assertions* (facts that must hold without knowing any specific number), *symmetry assertions* (transformed inputs must give correspondingly transformed outputs), and *cross-implementation agreement* (two independent implementations of different complexity must concur). Hand-calculated numbers appear nowhere.

---

## 0. The pragmatic trust chain

1. **The force rule** is trusted via property tests (Section 1) — no expected values required, because the properties fully pin down its behaviour: where it is zero, where its sign comes from, where it must repel.
2. **The naive calculator** — a double loop over all pairs applying the rule, with min-image distance in wrap mode, and *nothing else* — is trusted via the same scenario/symmetry tests (Section 2) plus its own simplicity: no grid, no sorting, no index arithmetic means almost nowhere for a bug to hide. It is deliberately slow and deliberately boring.
3. **The grid simulation** (the real implementation) is trusted by exact agreement with the naive calculator (Section 3). This is the centrepiece: it directly verifies the original product requirement — *no in-range particle excluded by the bucketing* — which is precisely where real bugs live (cell-edge off-by-ones, seam wrapping, counting-sort errors).

Each link is verified by the one below it; nothing rests on a human computing physics by hand.

---

## 1. Level 0 — force-rule property tests (~1 hour)

Pure-function tests on `rules.js`, sampling `r` across `(0, 1]` and `a` across `[-1, 1]`. No simulator involved. All of these are assertions about *structure*, not values:

- [ ] `f(1, a) == 0` for all sampled `a` (nothing pops at the cutoff)
- [ ] `f(beta, a) == 0` for all sampled `a` (continuity at the repulsion boundary)
- [ ] `f(r, a) < 0` for all `r < beta`, regardless of the sign of `a` (universal close-range repulsion)
- [ ] `sign(f(r, a)) == sign(a)` for `r ∈ (beta, 1)` (relationship coefficient drives behaviour)
- [ ] `f(r, 0) == 0` for `r ≥ beta` (zero relationship → zero interaction)
- [ ] `f(r, -a) == -f(r, a)` for `r ≥ beta` (the coefficient scales linearly — true of the canonical rule)
- [ ] `f((1+beta)/2, 1) ≥ f(r, 1)` for all sampled `r` (peak sits at the midpoint of the interaction band)
- [ ] no NaN/Inf anywhere on the sweep, including `r` approaching 0

If a future custom curve breaks one of these on purpose (e.g. a different peak location), update the test *deliberately* — the suite then documents the rule's contract.

---

## 2. Level 1 — tiny-scenario tests (~2–3 hours)

Two- and three-particle states evaluated through the **naive calculator**; every assertion is directional, boolean, or symmetry-based — never a magic number.

**Direction and range**
- [ ] `a > 0`, distance inside `(beta·rMax, rMax)` → particle accelerates **toward** the other (`dot(acc, toOther) > 0`); `a < 0` → away
- [ ] distance `< beta·rMax` → acceleration points away regardless of `a`'s sign
- [ ] distance `> rMax` → acceleration exactly zero; distance exactly `rMax` → zero (cutoff inclusive/exclusive behaviour pinned)
- [ ] coincident pair → finite output (ε guard), no NaN

**Asymmetry (the `rel[a→b]` ordering — the classic transcription bug)**
- [ ] `rel[A→B] = 1, rel[B→A] = 0` → A accelerates, B's acceleration is exactly zero (no number needed: zero vs non-zero)
- [ ] `rel[A→B] = 1, rel[B→A] = -1` → both accelerations point in the **same** direction (the chase configuration)

**Boundary / seam (wrap mode)**
- [ ] particles at `x ≈ 0` and `x ≈ worldW` within `rMax` across the seam → non-zero interaction, with acceleration pointing **across the seam**, not across the interior (sign check on `acc.x`)
- [ ] the same pair separated by more than `rMax` via the seam *and* the interior → zero
- [ ] corner case: wrapping in both axes simultaneously behaves the same way

**Superposition and symmetry (no values, high bug-catching power)**
- [ ] a particle placed exactly midway between two identical attractors → net acceleration ≈ 0 by symmetry
- [ ] three particles → acceleration on each equals the sum of the two pairwise evaluations (additivity)
- [ ] **translation invariance**: shift every position by a constant offset (well inside the world, or any offset in wrap mode) → identical accelerations
- [ ] **rotation invariance (90°)**: map every `(x, y) → (−y, x)` (and world dims if needed) → accelerations are the same rotation of the originals. This single test catches x/y transpositions and sign flips anywhere in the pipeline, with zero expected values.

---

## 3. Level 2 — naive vs grid agreement (~half a day, the centrepiece)

Procedure, run across ~5 seeds, n ≈ 200–1,000, **both boundary modes**, with some particles deliberately seeded near edges and corners:

1. Generate a random state (seeded).
2. Compute the **in-range pair set** with the naive calculator (all pairs, `d² ≤ rMax²`, min-image in wrap mode) and with the grid implementation (3×3 neighbourhood walk). Normalise each pair as `(min(i,j), max(i,j))`, sort, compare. **MUST be exactly equal as sets** — a missing pair is the bucketing bug your requirements forbid; an extra pair is a distance-filter bug.
3. Compute accelerations both ways and compare per particle within a small epsilon (a few ULPs scaled by neighbour count — the grid visits neighbours in a different order, so last-bit differences are legitimate; anything larger is a bug).
4. Step both one tick and compare positions the same way.

If step 2 passes and step 3 fails, the bug is in force evaluation, not bucketing; if 2 fails, fix the grid before looking at anything else. This ordering is the miniature version of the full document's bisect-by-phase playbook.

A failure here SHOULD immediately be reduced: re-run with n shrunk until the smallest failing state is found, then freeze that state as a regression test. Small failing states are debuggable in minutes; 1,000-particle failures are not.

---

## 4. Level 3 — boundary smoke tests (~1 hour)

Per the "assume libraries work" policy (Section 5), these do not test libraries — they test *your use* of them at each boundary, with one cheap check per boundary:

- [ ] **Render-doesn't-mutate**: run the sim T ticks headless and T ticks with the renderer attached, same seed; byte-compare `pos/vel/type` arrays (a simple loop or a trivial FNV hash — no need for the full snapshot format yet). Identical ⇒ rendering provably never touches simulation state. This one test converts every future "is it the sim or the renderer?" session into a one-line check.
- [ ] **Visual sanity against a known seed**: one documented seed whose qualitative outcome you've eyeballed ("clusters form by tick ~2,000"). Catches transposed axes, wrong colour-by-type indexing, and unit/scale errors that numeric tests are blind to. A screenshot in the repo is enough; automation comes later.

---

## 5. What you may assume, and what you may not

**Assume correct, never test:** the JS engine, `Float32Array`, `Math.sqrt`/`Math.abs`, Pixi's renderer internals, and later the browser's WebGPU implementation. These are incomparably better-tested than this project; effort spent testing them is wasted.

**Never assume, always cover:** your *calls into* those libraries (strides, offsets, dynamic/static flags, attribute formats — covered by the Level 3 smoke tests), and any logic of yours, however small, that wraps them. The realistic failure statement is never "the library is wrong"; it is "I'm holding it wrong", and that failure mode lives at the boundary — which is exactly where the smoke tests sit.

**Day-one habits that make all of the above work** (cheap now, expensive to retrofit):
- Seeded PRNG everywhere from the first commit; `Math.random()` banned. A failing test you cannot reproduce is worth almost nothing.
- Fixed iteration order in the sim (ascending particle index, fixed neighbourhood order) — this is what makes byte-comparison meaningful.
- The sim runnable headless (no DOM imports in `core/` or `sim/`) so all of the above runs under Node/CI from day one.

---

## 6. Deferral map — when the full oracle apparatus activates

Everything in the full *Correctness Oracle* document not listed above is deferred, guilt-free, until its trigger fires:

| Deferred apparatus | Build it when… |
|---|---|
| Snapshot format + load/dump round-trip | …a second backend exists (worker port, Stage 2) and identical state must be fed to both |
| Bit-exact hash gates (Class 1) | …same trigger; the byte-compare from Level 3 graduates into it |
| Replay harness as a uniform contract | …a *third* backend appears, or comparisons are being run by hand more than once a week |
| f64 twin + derived tolerances | …the first non-bit-exact backend (SIMD, threads, or GPU) makes "identical" unachievable |
| Statistical aggregates (KE bands, neighbour histograms) | …the GPU port (Class 3), where short-horizon comparison alone is insufficient |
| Version-controlled corpus with golden metrics | …the first time a regression bites, or the worker port — whichever comes first (frozen Level 2 failure states are its seed) |
| Per-stage gates, CI hardware pinning | …CI exists and the GPU backend is real |

The compounding property: each deferred item is an *extension* of something built today — the naive calculator becomes the Tier A twin, byte-compare becomes the hash gate, frozen failing states become the corpus, the known-seed eyeball check becomes the behavioural fingerprints. Nothing is rework.

---

## 7. Condensed checklist with budget

- [ ] (~1h) Rule property suite green — Section 1
- [ ] (~2–3h) Tiny-scenario suite green, including asymmetry, seam, translation + 90°-rotation invariance — Section 2
- [ ] (~half day) Naive-vs-grid: pair sets exactly equal, accelerations within ULP-scale epsilon, 1-tick positions agree — across seeds and both boundary modes — Section 3
- [ ] (~1h) Render-doesn't-mutate byte-compare + one known-seed visual reference — Section 4
- [ ] (day one, ongoing) Seeded PRNG only; fixed iteration order; headless-runnable sim — Section 5
- [ ] Tests run under Node/CI on every change (free once the above exist)

Total: roughly one focused day. After it, the simulation core is trustworthy enough to build the entire Stage 1–2 product on, and every later validation requirement has a foundation already poured.
