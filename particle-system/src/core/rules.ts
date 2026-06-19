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
    // Region 1 — universal short-range repulsion.
    const f = t/beta - 1
    return f;
  } else if (t < 1) {
    // Region 2 — affinity-scaled attraction/repulsion band.
    // low2 + (value - low1) * (high2 - low2) / (high1 - low1)
    const nt = 0 + (t - beta) * (1 - 0) / (1- beta)
    
    const f = (-Math.abs(2*nt - 1) + 1) * a
    return f;
  }

  return 0; // Region 3: beyond rMax, no interaction
}
