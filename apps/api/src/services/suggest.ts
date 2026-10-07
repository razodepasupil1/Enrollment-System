/**
 * Maximal conflict-free selections.
 *
 * `adj[i]` is a bitmask of the courses that clash with course i. A selection is "independent" when no two
 * of its courses clash, and "maximal" when no further course can be added without creating a clash.
 * Brute force over all 2^n subsets is fine because the API caps n at 12 (4096 subsets).
 */
export function maximalIndependentSets(n: number, adj: readonly number[]): number[][] {
  if (n === 0) return [];
  const full = (1 << n) - 1;
  const independent = (mask: number): boolean => {
    for (let i = 0; i < n; i++) if (mask & (1 << i) && adj[i]! & mask) return false;
    return true;
  };
  const sets: number[][] = [];
  for (let mask = 1; mask <= full; mask++) {
    if (!independent(mask)) continue;
    let extendable = false;
    for (let j = 0; j < n && !extendable; j++) if (!(mask & (1 << j)) && !(adj[j]! & mask)) extendable = true;
    if (!extendable) sets.push([...Array(n).keys()].filter((i) => mask & (1 << i)));
  }
  return sets;
}
