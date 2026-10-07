import { describe, expect, it } from "vitest";
import { maximalIndependentSets } from "../src/services/suggest.js";

const adjOf = (n: number, edges: Array<[number, number]>): number[] => {
  const adj = Array<number>(n).fill(0);
  for (const [a, b] of edges) { adj[a]! |= 1 << b; adj[b]! |= 1 << a; }
  return adj;
};
const norm = (sets: number[][]) => sets.map((s) => s.join(",")).sort();

describe("maximalIndependentSets", () => {
  it("no courses -> nothing to suggest", () => expect(maximalIndependentSets(0, [])).toEqual([]));
  it("no clashes -> one selection containing everything", () => expect(maximalIndependentSets(3, adjOf(3, []))).toEqual([[0, 1, 2]]));
  it("one clash between two courses -> two selections, one for each", () => expect(norm(maximalIndependentSets(2, adjOf(2, [[0, 1]])))).toEqual(["0", "1"]));
  it("a chain a-b-c: either {a,c} or {b}", () => expect(norm(maximalIndependentSets(3, adjOf(3, [[0, 1], [1, 2]])))).toEqual(["0,2", "1"]));
  it("a triangle of mutual clashes -> each course alone", () => expect(norm(maximalIndependentSets(3, adjOf(3, [[0, 1], [1, 2], [0, 2]])))).toEqual(["0", "1", "2"]));
  it("only returns MAXIMAL sets: nothing returned can be extended", () => {
    const adj = adjOf(5, [[0, 1], [2, 3]]);
    for (const set of maximalIndependentSets(5, adj)) {
      for (let j = 0; j < 5; j++) if (!set.includes(j)) expect(set.some((i) => adj[j]! & (1 << i))).toBe(true);
    }
  });
  it("handles the 12-course cap quickly", () => {
    const t0 = performance.now();
    expect(maximalIndependentSets(12, adjOf(12, [])).length).toBe(1);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
