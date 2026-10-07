export type AcademicStanding = "DEANS_LIST" | "GOOD_STANDING" | "PROBATION" | "NO_RECORD";

export interface GradeEntry {
  readonly grade: number;
  readonly units: number;
}

/**
 * Strategy interface: schools disagree on what a grade means (4.0 is best vs
 * 1.0 is best), so every grade comparison goes through a policy and the rest
 * of the code never hard-codes a direction.
 */
export interface GradingScale {
  readonly min: number;
  readonly max: number;
  readonly passMark: number;
  readonly higherIsBetter: boolean;
}

export interface GradingPolicy {
  readonly name: string;
  /** Machine-readable description of the scale, so the UI can build its grade input without guessing. */
  readonly scale: GradingScale;
  isValid(grade: number): boolean;
  isPass(grade: number): boolean;
  /** True when `grade` is at least as good as `minGrade` in this scale. */
  meetsMinimum(grade: number, minGrade: number): boolean;
  /** True when grade `a` is strictly better than `b` (higher on the 4.0 scale, lower on the 1.0-5.0 scale). */
  isBetter(a: number, b: number): boolean;
  /** Unit-weighted average, rounded to 2 decimals; null when there is nothing to average. */
  average(entries: readonly GradeEntry[]): number | null;
  standing(average: number | null): AcademicStanding;
  display(grade: number): string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Shared weighted-average maths; subclasses only supply the scale-specific parts. */
abstract class WeightedPolicy implements GradingPolicy {
  abstract readonly name: string;
  abstract readonly scale: GradingScale;
  abstract isValid(grade: number): boolean;
  abstract isPass(grade: number): boolean;
  abstract meetsMinimum(grade: number, minGrade: number): boolean;
  abstract isBetter(a: number, b: number): boolean;
  abstract standing(average: number | null): AcademicStanding;
  abstract display(grade: number): string;

  average(entries: readonly GradeEntry[]): number | null {
    const units = entries.reduce((s, e) => s + e.units, 0);
    if (units === 0) return null;
    return round2(entries.reduce((s, e) => s + e.grade * e.units, 0) / units);
  }
}

export interface FourPointConfig {
  /** Average at or above this earns Dean's List. */
  deansListMin?: number;
  /** Average below this is probation. */
  probationBelow?: number;
}

/** 0.0 to 4.0, higher is better. The default policy. */
export class FourPointPolicy extends WeightedPolicy {
  readonly name = "4.0 scale (higher is better)";
  readonly scale = { min: 0, max: 4, passMark: 1, higherIsBetter: true } as const;
  readonly #deansListMin: number;
  readonly #probationBelow: number;

  constructor(config: FourPointConfig = {}) {
    super();
    this.#deansListMin = config.deansListMin ?? 3.5;
    this.#probationBelow = config.probationBelow ?? 2.0;
  }

  isValid(g: number): boolean { return Number.isFinite(g) && g >= 0 && g <= 4; }
  isPass(g: number): boolean { return g >= 1.0; }
  meetsMinimum(g: number, min: number): boolean { return g >= min; }
  isBetter(a: number, b: number): boolean { return a > b; }

  standing(avg: number | null): AcademicStanding {
    if (avg === null) return "NO_RECORD";
    if (avg >= this.#deansListMin) return "DEANS_LIST";
    if (avg < this.#probationBelow) return "PROBATION";
    return "GOOD_STANDING";
  }

  display(g: number): string {
    // Midpoints between the usual grade points, so 3.7 reads "A-" and 3.0 reads "B".
    const table: ReadonlyArray<readonly [number, string]> = [
      [3.85, "A"], [3.5, "A-"], [3.15, "B+"], [2.85, "B"], [2.5, "B-"],
      [2.15, "C+"], [1.85, "C"], [1.5, "C-"], [1.0, "D"],
    ];
    return table.find(([min]) => g >= min)?.[1] ?? "F";
  }
}

export interface FivePointConfig {
  /** Average at or better (lower) than this earns Dean's List. */
  deansListMax?: number;
  /** Average worse (higher) than this is probation. */
  probationAbove?: number;
}

/** 1.0 (best) to 5.0 (fail), lower is better, 3.0 is the passing mark. Common in the Philippines. */
export class FivePointPolicy extends WeightedPolicy {
  readonly name = "1.0-5.0 scale (lower is better)";
  readonly scale = { min: 1, max: 5, passMark: 3, higherIsBetter: false } as const;
  readonly #deansListMax: number;
  readonly #probationAbove: number;

  constructor(config: FivePointConfig = {}) {
    super();
    this.#deansListMax = config.deansListMax ?? 1.5;
    this.#probationAbove = config.probationAbove ?? 2.5;
  }

  isValid(g: number): boolean { return Number.isFinite(g) && g >= 1 && g <= 5; }
  isPass(g: number): boolean { return g <= 3.0; }
  meetsMinimum(g: number, min: number): boolean { return g <= min; }
  isBetter(a: number, b: number): boolean { return a < b; }

  standing(avg: number | null): AcademicStanding {
    if (avg === null) return "NO_RECORD";
    if (avg <= this.#deansListMax) return "DEANS_LIST";
    if (avg > this.#probationAbove) return "PROBATION";
    return "GOOD_STANDING";
  }

  display(g: number): string { return g.toFixed(2); }
}

export function policyByName(name: string | undefined): GradingPolicy {
  return name === "five-point" ? new FivePointPolicy() : new FourPointPolicy();
}
