import { describe, expect, it } from "vitest";
import { FivePointPolicy, FourPointPolicy, type GradedCourse } from "../../src/domain/index.js";
import { InvariantError } from "../../src/errors/index.js";
import { makeCourse, makeEnrollment, makeStudent } from "../helpers/factories.js";

const g = (code: string, grade: number, units = 3, termId = 1): GradedCourse => ({
  code, title: code, units, grade, termId,
});

describe("Student basics", () => {
  it("validates its invariants", () => {
    expect(() => makeStudent({ fullName: " " })).toThrow(InvariantError);
    expect(() => makeStudent({ email: "nope" })).toThrow(InvariantError);
    expect(() => makeStudent({ yearLevel: 0 })).toThrow(InvariantError);
    expect(() => makeStudent({ maxUnits: 0 })).toThrow(InvariantError);
  });

  it("maps year level to class standing", () => {
    expect(makeStudent({ yearLevel: 1 }).classStanding()).toBe("FRESHMAN");
    expect(makeStudent({ yearLevel: 2 }).classStanding()).toBe("SOPHOMORE");
    expect(makeStudent({ yearLevel: 3 }).classStanding()).toBe("JUNIOR");
    expect(makeStudent({ yearLevel: 5 }).classStanding()).toBe("SENIOR");
  });

  it("isActive only for ACTIVE status", () => {
    expect(makeStudent().isActive()).toBe(true);
    expect(makeStudent({ status: "SUSPENDED" }).isActive()).toBe(false);
  });
});

describe("Student unit counting", () => {
  const s = makeStudent({ maxUnits: 12 });
  const a = makeCourse({ id: 1, units: 3 });
  const b = makeCourse({ id: 2, units: 4 });
  const w = makeCourse({ id: 3, units: 5 });

  it("counts ENROLLED units only, not waitlisted or dropped", () => {
    const list = [makeEnrollment(s, a), makeEnrollment(s, b), makeEnrollment(s, w, "WAITLISTED")];
    expect(s.totalUnits(list)).toBe(7);
    expect(s.remainingUnits(list)).toBe(5);
  });

  it("an approved overload raises the remaining units", () => {
    const list = [makeEnrollment(s, a), makeEnrollment(s, b)];
    expect(s.remainingUnits(list, 3)).toBe(8);
  });

  it("ignores enrollments that belong to someone else", () => {
    const other = makeStudent({ id: 99 });
    expect(s.totalUnits([makeEnrollment(other, a)])).toBe(0);
  });
});

describe("Student.hasCompleted", () => {
  const four = new FourPointPolicy();
  const five = new FivePointPolicy();

  it("true for a passing grade, false for a fail or no record", () => {
    const s = makeStudent({ transcript: [g("CS101", 3.0), g("MATH101", 0.0)] });
    expect(s.hasCompleted("CS101")).toBe(true);
    expect(s.hasCompleted("cs101")).toBe(true); // case-insensitive
    expect(s.hasCompleted("MATH101")).toBe(false);
    expect(s.hasCompleted("PHYS101")).toBe(false);
  });

  it("enforces a minimum grade on the 4.0 scale (higher is better)", () => {
    const s = makeStudent({ transcript: [g("CS101", 2.0)] });
    expect(s.hasCompleted("CS101", 2.0, four)).toBe(true);
    expect(s.hasCompleted("CS101", 3.0, four)).toBe(false);
  });

  it("enforces a minimum grade on the 5.0 scale (lower is better)", () => {
    const s = makeStudent({ transcript: [g("CS101", 2.0)] });
    expect(s.hasCompleted("CS101", 2.5, five)).toBe(true);
    expect(s.hasCompleted("CS101", 1.75, five)).toBe(false);
  });

  it("a later passing retake satisfies the prerequisite", () => {
    const s = makeStudent({ transcript: [g("CS101", 0.0, 3, 1), g("CS101", 3.0, 3, 2)] });
    expect(s.hasCompleted("CS101")).toBe(true);
    expect(s.hasAttempted("CS101")).toBe(true);
  });
});

describe("GPA under both grading strategies", () => {
  const transcript = [g("A", 4.0, 3), g("B", 2.0, 3), g("C", 3.0, 6)];

  it("4.0 scale: unit-weighted average", () => {
    // (4*3 + 2*3 + 3*6) / 12 = 3.0
    expect(makeStudent({ transcript }).gpa(new FourPointPolicy())).toBe(3);
  });

  it("5.0 scale: same maths, the policy only changes meaning", () => {
    const t = [g("A", 1.0, 3), g("B", 2.0, 3), g("C", 3.0, 6)];
    // (1*3 + 2*3 + 3*6) / 12 = 2.25
    expect(makeStudent({ transcript: t }).gpa(new FivePointPolicy())).toBe(2.25);
  });

  it("rounds to two decimals", () => {
    const t = [g("A", 4.0, 1), g("B", 3.0, 1), g("C", 3.0, 1)];
    expect(makeStudent({ transcript: t }).gpa()).toBe(3.33);
  });

  it("null when there is no graded work", () => {
    expect(makeStudent().gpa()).toBeNull();
  });

  it("a retaken course counts once, using the most recent term", () => {
    const t = [g("CS101", 0.0, 3, 1), g("CS101", 4.0, 3, 2)];
    expect(makeStudent({ transcript: t }).gpa()).toBe(4);
  });
});

describe("Academic standing", () => {
  it("4.0 scale thresholds (configurable)", () => {
    const p = new FourPointPolicy();
    expect(p.standing(3.6)).toBe("DEANS_LIST");
    expect(p.standing(2.5)).toBe("GOOD_STANDING");
    expect(p.standing(1.9)).toBe("PROBATION");
    expect(p.standing(null)).toBe("NO_RECORD");
    expect(new FourPointPolicy({ deansListMin: 3.0 }).standing(3.2)).toBe("DEANS_LIST");
  });

  it("5.0 scale thresholds run the other way", () => {
    const p = new FivePointPolicy();
    expect(p.standing(1.25)).toBe("DEANS_LIST");
    expect(p.standing(2.0)).toBe("GOOD_STANDING");
    expect(p.standing(2.75)).toBe("PROBATION");
  });
});

describe("Grading policy basics", () => {
  it("validates grade ranges", () => {
    const four = new FourPointPolicy();
    expect(four.isValid(4)).toBe(true);
    expect(four.isValid(4.1)).toBe(false);
    expect(four.isValid(Number.NaN)).toBe(false);
    const five = new FivePointPolicy();
    expect(five.isValid(1)).toBe(true);
    expect(five.isValid(0.5)).toBe(false);
  });

  it("pass marks differ per scale", () => {
    expect(new FourPointPolicy().isPass(1.0)).toBe(true);
    expect(new FourPointPolicy().isPass(0.99)).toBe(false);
    expect(new FivePointPolicy().isPass(3.0)).toBe(true);
    expect(new FivePointPolicy().isPass(3.25)).toBe(false);
  });

  it("displays letters on the 4.0 scale", () => {
    const p = new FourPointPolicy();
    expect([4, 3.7, 3.3, 3, 2, 1, 0].map((n) => p.display(n))).toEqual(["A", "A-", "B+", "B", "C", "D", "F"]);
  });
});

describe("GradingPolicy.isBetter", () => {
  it("higher is better on the 4.0 scale, lower is better on the 5.0 scale", () => {
    expect(new FourPointPolicy().isBetter(3.5, 2.0)).toBe(true);
    expect(new FourPointPolicy().isBetter(2.0, 3.5)).toBe(false);
    expect(new FivePointPolicy().isBetter(1.25, 2.5)).toBe(true);
    expect(new FivePointPolicy().isBetter(2.5, 1.25)).toBe(false);
  });
});
