import { describe, expect, it } from "vitest";
import { Enrollment, FivePointPolicy, FourPointPolicy } from "../../src/domain/index.js";
import { IllegalTransitionError, InvalidGradeError } from "../../src/errors/index.js";
import { NOW } from "../helpers/factories.js";

const DEADLINE = new Date("2026-09-30T00:00:00Z");
const enrolled = () => Enrollment.create({ studentId: 1, courseId: 2, seatAvailable: true, now: NOW });
const waitlisted = () => Enrollment.create({ studentId: 1, courseId: 2, seatAvailable: false, now: NOW });

describe("Enrollment.create", () => {
  it("takes the seat when one is available", () => {
    const e = enrolled();
    expect(e.status).toBe("ENROLLED");
    expect(e.enrolledAt).toEqual(NOW);
    expect(e.waitlistedAt).toBeNull();
    expect(e.isActive).toBe(true);
  });
  it("joins the waitlist when the course is full", () => {
    const e = waitlisted();
    expect(e.status).toBe("WAITLISTED");
    expect(e.waitlistedAt).toEqual(NOW);
    expect(e.enrolledAt).toBeNull();
  });
});

describe("legal transitions", () => {
  it("drop before the deadline -> DROPPED", () => {
    const e = enrolled();
    expect(e.drop(new Date("2026-09-15T00:00:00Z"), DEADLINE)).toBe("DROPPED");
    expect(e.status).toBe("DROPPED");
    expect(e.endedAt).not.toBeNull();
    expect(e.isActive).toBe(false);
  });
  it("drop exactly at the deadline is still DROPPED", () => {
    expect(enrolled().drop(DEADLINE, DEADLINE)).toBe("DROPPED");
  });
  it("drop after the deadline -> WITHDRAWN (a 'W')", () => {
    const e = enrolled();
    expect(e.drop(new Date("2026-10-01T00:00:00Z"), DEADLINE)).toBe("WITHDRAWN");
    expect(e.status).toBe("WITHDRAWN");
  });
  it("leaveWaitlist -> DROPPED", () => {
    const e = waitlisted();
    e.leaveWaitlist(NOW);
    expect(e.status).toBe("DROPPED");
  });
  it("promote -> ENROLLED and keeps waitlistedAt for the audit trail", () => {
    const e = waitlisted();
    const later = new Date("2026-09-02T00:00:00Z");
    e.promote(later);
    expect(e.status).toBe("ENROLLED");
    expect(e.enrolledAt).toEqual(later);
    expect(e.waitlistedAt).toEqual(NOW);
  });
  it("complete with a passing grade -> COMPLETED, failing -> FAILED", () => {
    const pass = enrolled();
    expect(pass.complete(3.0, new FourPointPolicy(), NOW)).toBe("COMPLETED");
    expect(pass.grade).toBe(3.0);
    const fail = enrolled();
    expect(fail.complete(0.0, new FourPointPolicy(), NOW)).toBe("FAILED");
  });
  it("pass/fail depends on the policy direction (5.0 scale: lower is better)", () => {
    expect(enrolled().complete(1.5, new FivePointPolicy(), NOW)).toBe("COMPLETED");
    expect(enrolled().complete(5.0, new FivePointPolicy(), NOW)).toBe("FAILED");
  });
});

describe("illegal transitions", () => {
  it("cannot drop a waitlisted enrollment (use leaveWaitlist)", () => {
    expect(() => waitlisted().drop(NOW, DEADLINE)).toThrow(IllegalTransitionError);
  });
  it("cannot promote an enrollment that already has a seat", () => {
    expect(() => enrolled().promote(NOW)).toThrow(IllegalTransitionError);
  });
  it("cannot leave the waitlist while enrolled", () => {
    expect(() => enrolled().leaveWaitlist(NOW)).toThrow(IllegalTransitionError);
  });
  it("cannot grade a waitlisted enrollment", () => {
    expect(() => waitlisted().complete(3, new FourPointPolicy(), NOW)).toThrow(IllegalTransitionError);
  });
  it("cannot drop twice", () => {
    const e = enrolled();
    e.drop(NOW, DEADLINE);
    expect(() => e.drop(NOW, DEADLINE)).toThrow(IllegalTransitionError);
  });
  it("a finished enrollment is frozen: no drop, promote, or regrade", () => {
    const e = enrolled();
    e.complete(3.5, new FourPointPolicy(), NOW);
    expect(() => e.drop(NOW, DEADLINE)).toThrow(IllegalTransitionError);
    expect(() => e.complete(2, new FourPointPolicy(), NOW)).toThrow(IllegalTransitionError);
  });
  it("rejects a grade outside the policy's scale and leaves the status untouched", () => {
    const e = enrolled();
    expect(() => e.complete(4.5, new FourPointPolicy(), NOW)).toThrow(InvalidGradeError);
    expect(() => e.complete(0.5, new FivePointPolicy(), NOW)).toThrow(InvalidGradeError);
    expect(e.status).toBe("ENROLLED");
  });
});

describe("persistence helpers", () => {
  it("snapshot -> restore round-trips", () => {
    const e = waitlisted();
    e.assignId(7);
    const copy = Enrollment.restore(e.toSnapshot());
    expect(copy.toSnapshot()).toEqual(e.toSnapshot());
  });
  it("assignId can only be called once", () => {
    const e = enrolled();
    e.assignId(1);
    expect(() => e.assignId(2)).toThrow(IllegalTransitionError);
  });
});
