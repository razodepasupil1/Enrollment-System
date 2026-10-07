import { describe, expect, it } from "vitest";
import { InvariantError } from "../../src/errors/index.js";
import { hm, makeCourse, meet } from "../helpers/factories.js";

describe("Course invariants", () => {
  it("rejects negative capacity, non-positive units, and meetings that end before they start", () => {
    expect(() => makeCourse({ capacity: -1 })).toThrow(InvariantError);
    expect(() => makeCourse({ units: 0 })).toThrow(InvariantError);
    expect(() => makeCourse({ meetings: meet(["MON"], hm(10), hm(9)) })).toThrow(InvariantError);
    expect(() => makeCourse({ meetings: meet(["MON"], hm(9), hm(9)) })).toThrow(InvariantError);
  });

  it("normalises the code to upper case", () => {
    expect(makeCourse({ code: " cs101 " }).code).toBe("CS101");
  });
});

describe("Course capacity", () => {
  const c = makeCourse({ capacity: 30 });
  it("computes available seats and full state", () => {
    expect(c.availableSeats(0)).toBe(30);
    expect(c.availableSeats(29)).toBe(1);
    expect(c.isFull(29)).toBe(false);
    expect(c.isFull(30)).toBe(true);
    expect(c.availableSeats(35)).toBe(0); // never negative
  });
  it("fillRatio is clamped and a zero-capacity course is always full", () => {
    expect(c.fillRatio(15)).toBe(0.5);
    expect(c.fillRatio(99)).toBe(1);
    expect(makeCourse({ capacity: 0 }).fillRatio(0)).toBe(1);
    expect(makeCourse({ capacity: 0 }).isFull(0)).toBe(true);
  });
});

describe("Course.conflictsWith", () => {
  const base = makeCourse({ id: 1, meetings: meet(["MON", "WED"], hm(9), hm(10, 30)) });

  it("detects overlapping times on the same day", () => {
    const other = makeCourse({ id: 2, meetings: meet(["MON"], hm(10), hm(11)) });
    expect(base.conflictsWith(other)).toBe(true);
    expect(other.conflictsWith(base)).toBe(true); // symmetric
  });

  it("back-to-back classes do NOT conflict", () => {
    const other = makeCourse({ id: 2, meetings: meet(["MON"], hm(10, 30), hm(12)) });
    expect(base.conflictsWith(other)).toBe(false);
  });

  it("same time on different days does not conflict", () => {
    const other = makeCourse({ id: 2, meetings: meet(["TUE", "THU"], hm(9), hm(10, 30)) });
    expect(base.conflictsWith(other)).toBe(false);
  });

  it("a class fully inside another conflicts", () => {
    const other = makeCourse({ id: 2, meetings: meet(["WED"], hm(9, 30), hm(10)) });
    expect(base.conflictsWith(other)).toBe(true);
  });

  it("different terms never conflict, and a course never conflicts with itself", () => {
    const otherTerm = makeCourse({ id: 2, termId: 2, meetings: meet(["MON"], hm(9), hm(10)) });
    expect(base.conflictsWith(otherTerm)).toBe(false);
    expect(base.conflictsWith(base)).toBe(false);
  });

  it("an unscheduled course conflicts with nothing", () => {
    expect(base.conflictsWith(makeCourse({ id: 2, meetings: [] }))).toBe(false);
  });
});

describe("Course.meetingSummary", () => {
  it("groups days that share a time slot", () => {
    expect(makeCourse({ meetings: meet(["WED", "MON"], hm(9), hm(10, 30)) }).meetingSummary()).toBe("Mon/Wed 9:00-10:30");
  });
  it("lists different slots separately and uses 24h time", () => {
    const c = makeCourse({
      meetings: [...meet(["MON"], hm(9), hm(10)), ...meet(["FRI"], hm(13), hm(15, 30))],
    });
    expect(c.meetingSummary()).toBe("Mon 9:00-10:00; Fri 13:00-15:30");
  });
  it("says TBA when there are no meetings", () => {
    expect(makeCourse({ meetings: [] }).meetingSummary()).toBe("TBA");
  });
});
