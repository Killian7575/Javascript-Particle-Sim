# Particle Life — Scale Up + Randomised Rules/Types (Teaching Plan)

## Context

The sim currently runs an **O(n²)** loop over an array of `vParticle` objects (`main.ts:237-273`),
recomputing `normaliseVector` (a `sqrt`) for every ordered pair (`main.ts:102-129`), with hard-coded
3-colour `switch` rules (`applyRules`, `main.ts:146-219`) and a `10/distance` falloff
(`calcDistanceStrength`, `main.ts:131-141`). That caps out around 1–2k particles and the rules can't
grow past 3 fixed colours.

You want to (a) push counts **much higher than 1000**, and (b) add a **randomised mode** (random rule
matrix + random particle types). Confirmed direction:

- **Scale:** pure-TS now (~tens of thousands @60fps); WASM/WebGPU deferred, but the hot loop must be
  **architected to move off the main thread/GPU later**.
- **Priority:** **behaviour + visual prettiness first**, then raw counts.
- **Physics:** the **classic Particle Life force curve with universal short-range repulsion**.
- **Controls:** a **lil-gui** panel.

**Outcome:** SoA typed arrays + spatial grid + rule matrix + classic force curve — tens of thousands of
glowing particles, randomisable live, laid out for a later WASM/WebGPU port.

---

## How we work together (teaching contract)

Your `CLAUDE.md` says I must not write the logic, and you've asked for **lots of explanation** because
everything past the current scope is new to you. So for every milestone this plan gives you:

- **Concept + why** — what the idea is and the problem it solves, in plain terms with a tiny example.
- **How it connects to code you already wrote** — I'll point at the lines you authored so each new idea
  has an anchor.
- **Scaffolding** — declarations, function signatures, and comment-step skeletons (same style as your
  existing `updateParticles` skeleton at `main.ts:222-233`), with every logic block left as a
  `// TODO (you):`.
- **How to verify** — a concrete check you can run.

**What I actually touch on approval, refined per your feedback:**

> *"When you write anything, explain the why/what/how with examples; and if it's close/adjacent to
> something I've already done, teach me to do it myself instead."*

- **Adjacent to your existing code → you do it, I coach.** The soft-glow texture is a small edit of your
  own `baseTexture` canvas block (`main.ts:28-38`); deleting the debug blocks is trivial. I will **not**
  write these — I'll explain exactly what to change and why, and you make the edit.
- **Genuinely new structure → I lay down the skeleton, you fill the TODOs.** New files, new typed-array
  declarations, new function signatures, comment-step skeletons. These come with a paragraph of "why"
  and a small illustrative snippet that is *not* the solution.
- **Purely mechanical, nothing to learn → I just do it.** Only `npm install lil-gui` falls here (and
  I'll still explain what lil-gui is and why it over hand-rolled DOM controls).

So: I write *less* than a normal plan would. The deliverable on approval is a **scaffolded, heavily
commented `main.ts` (+ optional new module files) full of explained TODOs**, not a working sim.

---

## Corrections / decisions grounded in the actual repo
- **`particle-simulation-notes.md` does not exist** anywhere in the repo. The original draft cited it
  throughout (`:32-48`, `:143-177`, etc.) — those citations are removed. Guidance below stands on the
  external references and your own code.
- **The canvas is appended to `document.body`** (`main.ts:53`), not the `<div id="app">` in
  `index.html`. The default Vite `style.css` styles `#app/#center/#next-steps` markup that nothing
  renders — it's dead styling. `body { margin: 0 }` already exists (`style.css:53-55`).
- **The `buffer = 20` is a bandaid, and we will fix it properly (M6).** See the dedicated section below
  — it was hiding a scrollbar caused by the canvas overflowing the viewport.
- **Architecture: system-level classes + module split pulled forward to M1.** Simulation state lives in a
  `ParticleSimulator` class (SoA arrays as fields), Pixi in a `Renderer` class, and the force curve in
  `rules.ts` — not module-level `let`s split later at M4/M5. Rationale: M1 rewrites every data-touching
  line anyway, so authoring them in their final files avoids moving the same code twice, and M1 being
  behaviour-preserving means the split happens while behaviour is pinned (the safest moment). Skeletons
  created: `simulation.ts`, `render.ts`, `rules.ts`.

## Key references
- **PixiJS v8 ParticleContainer** — rendering is *not* the bottleneck (built for hundreds of thousands
  to millions; the docs demo draws 100,000). Position is already declared dynamic (`main.ts:58-67`), so
  moving particles needs no `update()`; only changing the *particle list* or a *static* prop (tint) does.
  <https://pixijs.com/8.x/guides/components/scene-objects/particle-container>
- **lil-gui** — `npm install lil-gui`; `import GUI from 'lil-gui'`; `gui.add(obj,'prop',min,max).onChange(cb)`,
  `gui.addColor`, `gui.addFolder`, `gui.add(obj,'fn')` for a button. <https://github.com/georgealways/lil-gui>
- **Classic force curve** — Tom Mohr's *Particle Life* (`github.com/tom-mohr/particle-life`) and Jeffrey
  Ventrella's *Clusters*; the piecewise formula lives there (you implement it).

## tsconfig constraints (verified — `particle-system/tsconfig.json`)
- `erasableSyntaxOnly` → **no `enum`s**; keep `const` objects / numeric consts like `COLORS` (`main.ts:4-8`).
- `verbatimModuleSyntax` → `import type { Particle } from 'pixi.js'` for type-only imports (the `GUI`
  default import is a value — fine). *This rule matters more once we split files — see "Module split".*
- `noUnusedLocals/Parameters` → remove `debugCounter`/`debugCounter2` (`main.ts:22-23`) and stale params.
- `noFallthroughCasesInSwitch` → moot once the `switch` becomes a table lookup.

---

## Architecture overview

The single most important idea: **separate the *math* from the *drawing*.** Right now a particle *is* a
PixiJS object and you read/write `.x/.y/.vx` on it inside the physics loop. We split that into two layers:

- **Simulation state = Structure of Arrays (SoA).** Instead of an array of objects
  (`[{x,y,vx,vy,type}, …]`), we keep *parallel flat arrays*: `posX, posY, velX, velY: Float32Array`,
  `type: Uint8Array`. Particle `i` is `posX[i], posY[i], …`. **Why:** the CPU reads memory in cache
  lines; when all the `x` values sit contiguously the loop streams through memory predictably and the
  JIT can keep numbers unboxed. It's also the exact shape WASM/WebGPU want (a raw buffer), so this layout
  *is* the future-port enabler. (Contrast: your current `vParticle[]` scatters each particle's fields
  across the heap.)
- **Rendering bridge.** Keep a parallel `renderParticles: PIXI.Particle[]`, one per index, in the
  existing `ParticleContainer`. Each frame, after the physics, copy `posX[i]→renderParticles[i].x`. The
  physics never touches a Pixi object; the render layer never does math.
- **Rules = flat matrix.** `rules: Float32Array(NUM_TYPES*NUM_TYPES)`; "how type `a` responds to type
  `b`" = `rules[a*NUM_TYPES + b]` ∈ [-1,1]. One array read replaces your nested `switch`. (Flattening a
  2-D table into 1-D with `row*width + col` is the same trick a grid/bitmap uses.)
- **Neighbours = spatial grid.** Bucket indices into cells of side `RMAX`; each particle only checks its
  cell + 8 neighbours. Turns O(n²) into ~O(n).
- **Force = classic curve** `force(r,a,rMax,beta)` → a signed magnitude applied along the unit direction.

```mermaid
flowchart TD
  subgraph SoA["SoA state (hot loop — WASM/GPU-portable)"]
    P["posX/posY/velX/velY: Float32Array<br/>type: Uint8Array"]
  end
  R["rules: Float32Array (NUM_TYPES²) [-1,1]"]
  F["force(r,a,rMax,beta)"]
  G["spatial grid (cell = RMAX)"]
  P -->|each frame| G
  G -->|3×3 neighbour pairs| F
  R -->|a = rules[ti*N+tj]| F
  F -->|accumulate fx/fy| INT["integrate vel→pos<br/>+ boundaries + friction"]
  INT --> P
  P -->|copy x,y| RP["renderParticles[i] (PIXI.Particle)"]
  RP --> PC["ParticleContainer (GPU)"]
  GUI["lil-gui"] -.->|params / reseed / randomise| SoA
  GUI -.-> R
```

### Module split (done at M1)
Rather than defer to M4–M5, we split at M1. M1 rewrites every line that touches particle data anyway, so
authoring those lines straight into their final files avoids moving the same code twice; and because M1
is behaviour-preserving, the split happens while behaviour is pinned (the safest moment). The class
structure also keeps the in-flux physics inside `simulation.ts`/`rules.ts`, so the feedback loop stays
tight — which was the original worry behind "stay single-file."

- **Concept:** each `.ts` file is a *module*. Anything you `export` is importable elsewhere; everything
  else is private to the file (the compiler-enforced version of Python's `_name` convention). Because
  `verbatimModuleSyntax` is on, a *type-only* import must be written `import type { … }` — e.g. `render.ts`
  imports `ParticleSimulator` as a type, while `simulation.ts` imports `force` as a value.
- **Layout (created as class-based skeletons):** `simulation.ts` (`ParticleSimulator` class: SoA arrays +
  params + `seed`/`update`; the spatial grid joins as a field at M5), `rules.ts` (`force`; rule-matrix
  builder joins at M2/M6), `render.ts` (`Renderer` class: texture + palette + container + per-frame
  `sync`). `ui.ts` (lil-gui) is authored at M6. `main.ts` stays the orchestrator that wires them.
- **Dependency graph is a DAG:** `main → {simulation, render}`, `simulation → rules`,
  `render → simulation` (type-only), `rules → nothing`. No cycles, and the simulator never imports Pixi.

---

## Milestones (execution order)
> Correctness/feel first, performance second: get the classic physics right in the simple O(n²) loop,
> *then* wrap it in the grid. The GUI (M6) can be pulled forward whenever you want live sliders.
>
> **Architecture note:** the module split is done at M1 (see "Module split"). Where later milestones show
> module-level `let`s — the M5 grid fields, the M6 `params` — those now live as fields/methods on
> `ParticleSimulator`, and lil-gui binds straight to those fields.

### M0 — Hot-loop cleanup (you do it; trivial)
- **Why:** the `console.log` debug blocks (`main.ts:116-126` and `161-165`) run inside the hottest path
  (per pair, per frame), and `debugCounter`/`debugCounter2` (`main.ts:22-23`) will fail `noUnusedLocals`
  the moment we refactor around them.
- **You do it (adjacent to your own code):** delete both debug blocks and both counters.
- **Verify:** `cd particle-system && npm run dev` behaves the same; no console spam.

### M1 — SoA refactor (foundation; behaviour-preserving)
- **Why:** see "SoA" above — flat typed arrays for cache-friendliness and a future port. Same O(n²),
  same 3-colour behaviour; this milestone *only* changes how state is stored, so you can confirm nothing
  visually changed and trust the data swap.
- **Concept anchor:** today you write `forceTarget.vx += …; forceTarget.x += …` on a Pixi object
  (`main.ts:248-251`). After this, the same arithmetic happens on `velX[i] += …; posX[i] += …`, and a
  final loop copies `posX[i]→renderParticles[i].x`. Identical math, different container.
- **I scaffold (created as class-based skeletons — see the files; not duplicated here, to avoid drift):**
  - `simulation.ts` — `ParticleSimulator` class: the SoA arrays (`posX`/`posY`/`velX`/`velY` as
    `Float32Array`, `type` as `Uint8Array`) and reused `accX`/`accY` accumulators as fields, plus
    tunables (`rMax`, `beta`, `friction`), with `constructor`/`seed`/`update` signatures whose bodies
    are `// TODO (you):`.
  - `render.ts` — `Renderer` class owning the texture, palette, `ParticleContainer`, and the
    `renderParticles` GPU mirror; `sync(sim)` copies `posX[i]` → `renderParticles[i].x` each frame.
  - `rules.ts` — `force(r, a, rMax, beta)` stub (M1: reproduce `calcDistanceStrength`).
  Constraints baked in: no constructor parameter-property shorthand (`erasableSyntaxOnly`); allocate the
  accumulators ONCE (see below); hoist `this.*` to locals at the top of `update()`'s hot loop.
- **You write:** allocation, fills, the loops, integration, sync. **Drop** the `vParticle` interface
  (`main.ts:14-17`) and the `as vParticle` cast — velocity now lives in `velX/velY`.
- **Why allocate accumulators once:** `new Float32Array(n)` every frame creates garbage the collector
  must reclaim, causing periodic frame hitches; reusing one buffer keeps the loop allocation-free.
- **Verify:** motion at 1000 particles looks identical to before the refactor.

### M2 — Generalised types + rule matrix (decouple behaviour from code)
- **Why:** your `switch` (`main.ts:167-216`) hard-codes 3 colours and bakes the rules into control flow —
  you can't add a type without writing more `case`s. A *data* table (`rules`) lets behaviour be edited,
  randomised, or GUI-driven without touching code.
- **Concept anchor:** `rules[a*NUM_TYPES + b]` is the one number your whole `switch` was computing — the
  coefficient for "type `a` feeling type `b`". Replacing branches with a lookup is the same move as
  swapping a chain of `if`s for an array index.
- **I scaffold:**
  ```ts
  let NUM_TYPES = 4;
  let palette: number[];      // length NUM_TYPES — hex tint per type
  let rules: Float32Array;    // NUM_TYPES*NUM_TYPES, each in [-1,1]
  function buildPalette(n: number): number[] {
    // TODO (you): n evenly-spaced HSL hues -> hex. Tiny example of the idea (not the solution):
    //   hue = i / n * 360;  then HSL(hue, ~100%, ~60%) -> a 0xRRGGBB number.
  }
  // In the pair loop, replace applyRules' switch with one read:
  //   const a = rules[type[i] * NUM_TYPES + type[j]];
  ```
- **You write:** `buildPalette`; a hand-set `rules` matrix that roughly recreates your current
  blue-attracts / red-green-repel feel (so you can eyeball that the table reproduces the old behaviour);
  and the lookup wiring that retires `applyRules`, `COLORS`, and the `switch`.
- **Verify:** behaviour resembles your old preset, but colour/affinity now come from `palette`/`rules`,
  not `COLORS`.

### M3 — Classic force curve + short-range repulsion (BEHAVIOUR — priority)
- **Why:** your `10/distance` falloff (`calcDistanceStrength`) only ever attracts-or-repels monotonically,
  so clusters collapse to a point. The classic curve has a **built-in short-range repulsion** that holds
  particles apart, which is what makes Particle Life form stable cells/membranes instead of dots.
- **Concept:** work in *normalised* distance `t = r / rMax` (so the curve is radius-independent) with
  three regions:
  1. `t < beta` — **universal repulsion**, ramping from strong-push at `t=0` to 0 at `t=beta`. Ignores
     the rule `a` (everything repels up close). This is the anti-collapse term.
  2. `beta ≤ t < 1` — an **attraction/repulsion band** shaped like a triangle peaking between `beta` and
     1, scaled by `a` (so `a>0` attracts, `a<0` repels).
  3. `t ≥ 1` — **zero** (out of range).
  Plus a **squared-distance cutoff**: compare `dx*dx+dy*dy` to `rMax*rMax` *before* doing `sqrt`, so far
  pairs skip the expensive root entirely.
- **I scaffold (skeleton only — the two expressions are yours from the reference):**
  ```ts
  let RMAX = 100;   // interaction radius (== future CELL_SIZE). `let`, not const — M6 makes it live.
  let BETA = 0.3;   // fraction of RMAX that is pure repulsion
  function force(r: number, a: number, rMax: number, beta: number): number {
    const t = r / rMax;
    // TODO (you):
    // if (t < beta)   -> Region 1: repulsion that ramps to 0 at t=beta (no `a`)
    // else if (t < 1) -> Region 2: a * triangular peak between beta and 1
    return 0;          // Region 3
  }
  // In the pair loop, BEFORE sqrt:  if (dx*dx + dy*dy > rMax*rMax) continue;
  ```
- **You write:** the Region 1 & 2 expressions (Tom Mohr / Ventrella), the squared-distance guard, and
  applying `force * unitDirection` into `accX/accY`. Retire `calcDistanceStrength`.
- **Verify:** clusters form **stable** structures and never collapse to a single point (repulsion works);
  flipping the sign of one `rules` entry visibly switches that pair between attract and repel.

### M4 — Visual polish (PRETTINESS — priority)
- **Why:** "glowing life" comes from three cheap tricks, none of which need per-particle cost.
  1. **Soft glow texture (you edit your own code).** Your `baseTexture` draws a hard 3px filled arc
     (`main.ts:28-38`). A glow is the *same canvas approach* but filled with a **radial gradient** (opaque
     white centre → transparent edge) on a slightly larger canvas. Because this is a direct evolution of
     code you wrote, **you make the edit** — here's the *why/how*, not the code: create a bigger canvas
     (say 32×32), `const g = ctx.createRadialGradient(cx,cy,0, cx,cy,radius)`, add a white-opaque stop at
     0 and a white-transparent stop at 1, set `ctx.fillStyle = g`, fill a circle/rect, then
     `PIXI.Texture.from(canvas)` exactly as you do now. The gradient's alpha falloff *is* the glow.
  2. **Additive blending.** `particleContainer.blendMode = 'add'` makes overlapping particles *sum* their
     light, so dense clusters brighten — the core of the "alive" look on a dark background (your bg is
     already `0x111111`, `main.ts:49`). v8 uses string blend modes; **confirm the exact string in the
     PixiJS blend-mode docs** before relying on it. Fallback that's certain to work: the soft texture alone.
  3. **Vivid HSL palette** from `buildPalette` (M2).
  4. *Optional later:* faint motion trails (don't fully clear each frame — draw a low-alpha dark quad, or
     ping-pong a `RenderTexture`); bloom via `pixi-filters` `AdvancedBloomFilter` (verify filters apply to
     `ParticleContainer` in v8 first).
- **I scaffold:** nothing new to write here — (1) is your edit, (2)/(3) are one-liners I'll point to.
- **Verify:** particles read as soft glows; overlapping same-type particles visibly brighten.

### M5 — Spatial grid (SCALE — unlock tens of thousands)
- **Why:** O(n²) at 50k is 2.5 billion pair checks/frame — impossible at 60fps. But a particle only
  affects others within `RMAX`. If we bin particles into a grid of cells sized `RMAX`, every in-range
  neighbour is in the particle's own cell or the 8 around it (a 3×3 block). Checking only those is ~O(n).
- **Concept:** `cellIndex = floor(x/CELL_SIZE) + floor(y/CELL_SIZE)*cols` flattens a 2-D cell coordinate
  to 1-D (same `row*width+col` trick as the rule matrix). Each frame you (re)bin, then for each particle
  loop the 3×3 cells around it for candidate `j`s.
- **I scaffold (start simple; optimise later):**
  ```ts
  let CELL_SIZE = RMAX;          // optimal: equal to RMAX (bigger cells = more candidates per cell)
  let cols: number, rowsCount: number;
  // Phase A (clear): const grid = new Map<number, number[]>(), rebuilt each frame.
  // Phase B (fast, zero per-frame alloc): counting sort into flat cellStart/cellCount + a sorted index array.
  function buildGrid() {
    // TODO (you): compute cols/rowsCount from screen size; bucket every index by its cellIndex.
  }
  ```
  The update loop's *iteration* changes (3×3 cells instead of all-j); the force math is unchanged.
- **You write:** `buildGrid`, the 3×3 neighbour walk, and — as an optimisation — a `j > i` guard so each
  unordered pair is handled once, computing the geometry once and applying force to **both** `i` and `j`
  (force on `j` uses `rules[type[j]*NUM_TYPES + type[i]]` and the negated direction). Start with the
  `Map` version for clarity; move to the flat counting-sort grid for throughput.
- **Perf note:** cost scales with *particles per cell* (density × `RMAX²`), not just `count` — if FPS
  drops, lowering `RMAX` helps as much as lowering `count`.
- **Verify:** raise `count` to 10k–50k (temporary constant, or via M6's GUI); FPS holds ~60 (log
  `app.ticker.FPS` or add `stats.js`). At a fixed seed, grid output matches the naive O(n²) output.

### M6 — Randomised mode, lil-gui panel, and the resize fix (core ask + tuning UX)
- **Why:** the headline feature — fresh random `rules`/types on demand — plus live sliders to *feel* how
  `RMAX`/`BETA`/friction change the system. lil-gui gives you all of this for ~10 lines instead of
  hand-built DOM; that's why we install it rather than write controls.
- **I install (mechanical):** `npm install lil-gui`, add `import GUI from 'lil-gui'`.
- **I scaffold (the wiring shell — you fill every body):**
  ```ts
  function randomiseRules() { /* TODO (you): fill rules[] with random values in [-1,1] */ }
  function reseed()         { /* TODO (you): re-randomise posX/posY and type[];
                                 if you change the particle LIST or any tint, call particleContainer.update() */ }
  function setNumTypes(n: number) { /* TODO (you): realloc palette + rules for n, rebuild particles */ }
  function buildGui() {
    const params = { count, NUM_TYPES, RMAX, BETA, friction: targetFriction, forceFactor: 1, paused: false };
    const gui = new GUI();
    gui.add(params, 'count', 1000, 50000, 1000).onChange(/* TODO rebuild */);
    gui.add(params, 'NUM_TYPES', 2, 8, 1).onChange(/* TODO setNumTypes */);
    gui.add(params, 'RMAX', 20, 200);  gui.add(params, 'BETA', 0, 0.9);
    gui.add(params, 'friction', 0, 1); gui.add(params, 'forceFactor', 0, 5);
    gui.add(params, 'paused');
    gui.add({ randomiseRules }, 'randomiseRules');   // function -> button
    gui.add({ reseed }, 'reseed');
    // optional: a folder of NUM_TYPES² sliders to hand-edit the matrix
  }
  ```
- **You write:** the random fills, the realloc/rebuild logic, and the `onChange` callbacks. Two gotchas
  I'll flag: (a) `RMAX`/`BETA` are `let` (M3) so sliders can mutate them; (b) **static-vs-dynamic** —
  moving particles is free, but changing the particle *list* or a *tint* is a static change → call
  `particleContainer.update()` (per the PixiJS guide).
- **You also fix the resize bandaid here.** Your `buffer = 20` (`main.ts:12,47-48`) shrinks the canvas by
  20px so a scrollbar doesn't appear — but the real cause is that an inline `<canvas>` sized to
  `window.innerWidth/Height` slightly overflows the document (canvas defaults to `display:inline`, which
  reserves descender space, and/or body padding), forcing a scrollbar; your bandaid hides it by
  under-sizing, which also means the particle field doesn't fill the view. **Proper fix (you do it, I'll
  explain each step):**
  - give the canvas `display:block` (kills the inline descender gap) — either a one-line rule in
    `style.css` or `app.canvas.style.display = 'block'` after `appendChild`;
  - size the app to the *full* viewport (drop the `-buffer`), and use Pixi's `resizeTo: window` (or a
    `window.resize` handler calling `app.renderer.resize(innerWidth, innerHeight)`), so the field always
    fills the screen and follows window changes;
  - then delete the `buffer` constant.
  Doing this alongside the GUI is sensible because both touch setup/layout, and you'll want the full field
  visible while tuning.
- **Verify:** "randomiseRules"/"reseed"/`NUM_TYPES` each produce visibly different emergent life; sliders
  change behaviour live; pause freezes motion; the canvas fills the window with **no scrollbar**, and
  resizing the window keeps it full-bleed.

### M7 — Future: WASM / WebGPU (deferred)
Not this pass — M1's SoA layout is the enabler. Sketch: Rust→WASM `updateParticles` as one batched call
per frame over the typed-array buffers (`wasm-pack` + `vite-plugin-wasm`), never crossing JS↔WASM per
particle; eventually a WebGPU compute shader (Pixi v8 has a WebGPU backend) so positions never leave the
GPU.

---

## Files to touch
- `particle-system/src/main.ts` — orchestrator: app init, instantiate sim + renderer, ticker loop, GUI (M6).
- `particle-system/src/simulation.ts` — `ParticleSimulator` (SoA + grid + `update`); created at M1.
- `particle-system/src/rules.ts` — `force` curve + rule-matrix builder; created at M1, grown at M2/M3.
- `particle-system/src/render.ts` — `Renderer` (texture + palette + container + sync); created at M1.
- `particle-system/src/ui.ts` — lil-gui panel; authored at M6.
- `particle-system/package.json` — add `lil-gui` (M6); optionally `pixi-filters` / WASM tooling later.
- `particle-system/src/style.css` — small M6 change: `canvas { display:block }` for the resize fix.
- `particle-system/index.html` — optional cleanup: the unused `<div id="app">` can stay or go.

## Verification (end-to-end)
1. `cd particle-system && npm run dev` → particles move and (post-M4) glow; **no scrollbar**, full-bleed.
2. **Type-check:** `npm run build` (`tsc`) → zero errors under strict tsconfig (no `enum`, `import type`
   for type-only imports, no unused locals/params).
3. **Behaviour:** classic curve → stable clusters, no point-collapse; sign flip switches attract/repel.
4. **Scale:** raise `count` via the GUI into the tens of thousands; `app.ticker.FPS` holds ~60; grid vs
   naive match at a fixed seed.
5. **Randomise:** randomiseRules/reseed/`NUM_TYPES` give visibly different emergent life each time.
6. **Visual:** soft glow + additive brightening on overlap against the dark background.
