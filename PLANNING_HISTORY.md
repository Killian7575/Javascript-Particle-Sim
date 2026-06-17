# Planning History (archived)

This file catalogues earlier planning snapshots that have since been **superseded by
[`PARTICLE_LIFE_PLAN.md`](./PARTICLE_LIFE_PLAN.md)**. It is kept for historical reference only — do not
treat it as the current direction. The active plan is the source of truth.

---

## Early planning — initial 3-colour stub phase

This was the state of the project and its intended next steps *before* the scale-up / randomised-rules
plan. At this point `applyRules` and `updateParticles` were stubs and the sim ran the simple 3-colour
`switch` over a `vParticle[]`.

### Current state (at time of writing)
- PixiJS v8 app initializes with a full-screen canvas
- A shared circle texture is created for all particles
- `initParticles(count)` creates randomly colored, randomly positioned particles using `PIXI.Particle`
  and `PIXI.ParticleContainer`
- `applyRules(p1, p2)` — stub, returns zero force
- `updateParticles(dt)` — stub, does nothing yet

### Planned rules (starting point)
- Blue attracts both red and green
- Red and green repel each other
- All at the same strength

### Next steps I needed to implement
1. Store velocity (`vx`, `vy`) on each particle so they can move
2. Implement `applyRules` — compute distance, decide attraction/repulsion, return a force vector
3. Implement `updateParticles` — accumulate forces, update velocities and positions, handle boundaries,
   sync to GPU via `particleContainer.update()`

> **Superseded by `PARTICLE_LIFE_PLAN.md`:** velocity now lives in flat `velX`/`velY` typed arrays
> (SoA, M1) rather than on each particle; the 3-colour `switch` becomes a `NUM_TYPES`-wide rule matrix
> (M2); and the force model becomes the classic Particle Life curve with short-range repulsion (M3).
