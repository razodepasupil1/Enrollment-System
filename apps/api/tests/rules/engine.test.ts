import { describe, expect, it } from "vitest";
import { AlreadyEnrolledError, CourseFullError, errorFromViolations, HoldActiveError, ScheduleConflictError } from "../../src/errors/index.js";
import { block, defaultRules, RuleEngine, type EnrollmentContext, type EnrollmentRule } from "../../src/rules/index.js";
import { hm, makeCourse, makeCtx, makeEnrollment, makeStudent, meet, NOW } from "../helpers/factories.js";

const engine = new RuleEngine();

describe("RuleEngine outcomes", () => {
  it("ENROLL when everything passes", () => {
    const r = engine.evaluate(makeCtx());
    expect(r.outcome).toBe("ENROLL");
    expect(r.violations).toEqual([]);
  });

  it("WAITLIST when the only finding is a full course", () => {
    const r = engine.evaluate(makeCtx({ course: makeCourse({ capacity: 2 }), enrolledCount: 2 }));
    expect(r.outcome).toBe("WAITLIST");
    expect(r.violations.map((v) => v.code)).toEqual(["COURSE_FULL"]);
  });

  it("a block beats the waitlist: full + missing prerequisite is BLOCKED", () => {
    const course = makeCourse({ capacity: 1, prerequisites: [{ code: "CS101", minGrade: null }] });
    const r = engine.evaluate(makeCtx({ course, enrolledCount: 1 }));
    expect(r.outcome).toBe("BLOCKED");
  });
});

describe("RuleEngine aggregates every violation", () => {
  it("returns prerequisite + conflict + hold together, not just the first", () => {
    const student = makeStudent();
    const math = makeCourse({ id: 50, code: "MATH120", meetings: meet(["MON", "WED"], hm(9), hm(10, 30)) });
    const course = makeCourse({
      id: 51, code: "CS201",
      meetings: meet(["MON"], hm(10), hm(11)),
      prerequisites: [{ code: "CS101", minGrade: null }],
    });
    const r = engine.evaluate(
      makeCtx({
        course, student,
        activeEnrollments: [makeEnrollment(student, math)],
        holds: [{ id: 1, studentId: 1, type: "FINANCIAL", reason: "Unpaid balance", placedAt: NOW, clearedAt: null }],
      }),
    );
    expect(r.outcome).toBe("BLOCKED");
    expect(r.violations.map((v) => v.code).sort()).toEqual(["HOLD_ACTIVE", "PREREQUISITE_NOT_MET", "SCHEDULE_CONFLICT"]);
  });
});

describe("Open/closed principle", () => {
  it("a new rule is just a new class; no existing rule is edited", () => {
    class NoMondaysRule implements EnrollmentRule {
      readonly code = "NO_MONDAYS";
      check({ course }: EnrollmentContext) {
        return course.meetings.some((m) => m.day === "MON") ? [block(this.code, "No Monday classes.")] : [];
      }
    }
    const custom = new RuleEngine([...defaultRules(), new NoMondaysRule()]);
    expect(custom.evaluate(makeCtx()).outcome).toBe("BLOCKED"); // factory course meets Mon/Wed
    expect(engine.evaluate(makeCtx()).outcome).toBe("ENROLL"); // default engine unaffected
  });
});

describe("errorFromViolations", () => {
  it("maps the first blocking violation to a specific error class with a stable code", () => {
    const hold = errorFromViolations([block("HOLD_ACTIVE", "held")]);
    expect(hold).toBeInstanceOf(HoldActiveError);
    expect(hold.code).toBe("HOLD_ACTIVE");
    expect(hold.status).toBe(422);
    expect(errorFromViolations([block("SCHEDULE_CONFLICT", "x")])).toBeInstanceOf(ScheduleConflictError);
    expect(errorFromViolations([block("ALREADY_ENROLLED", "x")])).toBeInstanceOf(AlreadyEnrolledError);
    expect(errorFromViolations([{ code: "COURSE_FULL", message: "x", severity: "warn" }])).toBeInstanceOf(CourseFullError);
  });

  it("keeps all violations in details and mentions how many more issues exist", () => {
    const err = errorFromViolations([block("HOLD_ACTIVE", "held"), block("SCHEDULE_CONFLICT", "clash"), block("PREREQUISITE_NOT_MET", "prereq")]);
    expect(err.code).toBe("HOLD_ACTIVE");
    expect(err.message).toBe("held (and 2 more issues)");
    expect((err.details as { violations: unknown[] }).violations).toHaveLength(3);
  });

  it("unknown blocker codes fall back to a generic rejection", () => {
    const err = errorFromViolations([block("STUDENT_INACTIVE", "inactive")]);
    expect(err.code).toBe("STUDENT_INACTIVE");
    expect(err.status).toBe(422);
  });
});
