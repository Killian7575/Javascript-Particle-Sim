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
  // Work in normalised distance: t=0 at contact, t=1 at rMax.
  // The same curve shape applies at any rMax — scale-independent.
  const t = r / rMax;

  if (t < beta) {
    // TODO (you): Region 1 — universal short-range repulsion.
    // At t=0 the push is at maximum strength; at t=beta it reaches exactly 0.
    // This region IGNORES `a` — every type pair repels up close, which is
    // what prevents clusters from collapsing to a single point.
    //
    // Ask: what simple expression of (t / beta) equals -1 when t=0
    // and 0 when t=beta?  Tom Mohr's repo has the formula.
    const f = t/beta - 1
    return f;
  } else if (t < 1) {
    // TODO (you): Region 2 — affinity-scaled attraction/repulsion band.
    // This is a triangular wave: 0 at t=beta, a peak in the middle of [beta,1),
    // then 0 again at t=1.  Multiply the whole shape by `a` so that
    // a>0 attracts (positive peak) and a<0 repels (negative peak).
    //
    // Hint: first remap t from the sub-range [beta, 1) into a [0, 1) variable,
    // then shape that into a value that peaks at 0.5 and is 0 at both ends.
    // low2 + (value - low1) * (high2 - low2) / (high1 - low1)
    const nt = 0 + (t - beta) * (1 - 0) / (1- beta)
    
    const f = (-Math.abs(2*nt - 1) + 1) * a
    return f;
  }

  return 0; // Region 3: beyond rMax, no interaction
}
