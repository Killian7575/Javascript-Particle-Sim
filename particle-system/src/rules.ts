// =============================================================================
// rules.ts — "what types feel toward each other, and how that varies with distance."
//
// Pure functions only: no state, no imports, no Pixi. That makes this the easiest
// file to unit-test and to port (it's just maths). It GROWS across milestones, but
// you EDIT IT IN PLACE — nothing moves between files:
//   M1: make `force` reproduce your current calcDistanceStrength falloff (behaviour-preserving)
//   M3: replace `force`'s body with the classic Particle Life curve (3 regions)
//   M2/M6: a rules-MATRIX builder may join here later; the matrix DATA itself lives
//          on the simulator (it's mutable state), not in this stateless file.
// =============================================================================

/**
 * Signed force magnitude felt at distance `r`, given affinity coefficient `a`
 * (a > 0 attracts, a < 0 repels). The CALLER multiplies this by the unit
 * direction (nx, ny) and accumulates it. Returns 0 at/beyond rMax.
 *
 * @param r     distance between the two particles
 * @param a     affinity coefficient for this ordered type pair, in [-1, 1]
 * @param rMax  interaction radius (curve is radius-independent via t = r/rMax)
 * @param beta  fraction of rMax that is pure short-range repulsion (used from M3)
 */
export function force(r: number, a: number, rMax: number, beta: number): number {
  // TODO (you):
  //   M1 (behaviour-preserving): reproduce your calcDistanceStrength falloff
  //       (main.ts:131-141), scaled by `a`, so the sim looks identical after the refactor.
  //       (rMax/beta go unused until M3 — that's expected; see the "checklist" note.)
  //   M3: replace with the classic 3-region curve (PARTICLE_LIFE_PLAN.md:218-247):
  //       const t = r / rMax;
  //         t < beta  -> universal repulsion, ramps strong-push@0 -> 0@beta (ignores `a`)
  //         t < 1     -> a * triangular peak between beta and 1
  //         else      -> 0

  // M1:
  let strength = 0;
  if (r <= 10) { // 10, x = 10 is where formula starts at 1
    strength = 1;
  } else if (r > 100) { // 100, at x = 100, formula would be 0.1
    strength = 0;
  } else {
    strength = 10 / r;
  }
  
  return strength * a;
}
