import { describe, expect, it } from "vitest";
import { FivePointPolicy, type GradedCourse, type Hold } from "../../src/domain/index.js";
import {
  CapacityRule, CorequisiteRule, DuplicateEnrollmentRule, HoldRule, PrerequisiteRule,
  RegistrationWindowRule, ScheduleConflictRule, StudentStatusRule, TermMatchRule, UnitLimitRule,
} from "../../src/rules/index.js";
import { hm, makeCourse, makeCtx, makeEnrollment, makeStudent, makeTerm, meet, NOW } from "../helpers/factories.js";

const g = (code: string, grade: number): GradedCourse => ({ code, title: code, units: 3, grade, termId: 0 });
const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe("StudentStatusRule", () => {
  it("passes for active students, blocks otherwise", () => {
    expect(new StudentStatusRule().check(makeCtx())).toEqual([]);
    const v = new StudentStatusRule().check(makeCtx({ student: makeStudent({ status: "SUSPENDED" }) }));
    expect(codes(v)).toEqual(["STUDENT_INACTIVE"]);
    expect(v[0]?.severity).toBe("block");
  });
});

describe("TermMatchRule", () => {
  it("blocks courses outside the current term", () => {
    expect(new TermMatchRule().check(makeCtx())).toEqual([]);
    const v = new TermMatchRule().check(makeCtx({ term: makeTerm({ isCurrent: false, name: "Spring 2026" }) }));
    expect(codes(v)).toEqual(["TERM_NOT_CURRENT"]);
    expect(v[0]?.message).toContain("Spring 2026");
  });
});

describe("RegistrationWindowRule", () => {
  const rule = new RegistrationWindowRule();
  it("allows enrollment inside the window", () => {
    expect(rule.check(makeCtx())).toEqual([]);
  });
  it("blocks before it opens and after it closes", () => {
    expect(codes(rule.check(makeCtx({ now: new Date("2026-07-01T00:00:00Z") })))).toEqual(["REGISTRATION_NOT_OPEN"]);
    expect(codes(rule.check(makeCtx({ now: new Date("2026-11-01T00:00:00Z") })))).toEqual(["REGISTRATION_CLOSED"]);
  });
  it("honours a later priority opening for a lower class standing", () => {
    const term = makeTerm({ priorityOpenings: { FRESHMAN: new Date("2026-09-10T00:00:00Z") } });
    const freshman = makeStudent({ yearLevel: 1 });
    const sophomore = makeStudent({ yearLevel: 2 });
    const v = rule.check(makeCtx({ term, student: freshman }));
    expect(codes(v)).toEqual(["REGISTRATION_NOT_OPEN"]);
    expect(v[0]?.message).toContain("freshman");
    expect(rule.check(makeCtx({ term, student: sophomore }))).toEqual([]);
  });
});

describe("HoldRule", () => {
  const hold = (over: Partial<Hold> = {}): Hold => ({
    id: 1, studentId: 1, type: "FINANCIAL", reason: "Unpaid balance", placedAt: NOW, clearedAt: null, ...over,
  });
  it("blocks on every active hold and shows the reason", () => {
    const v = new HoldRule().check(makeCtx({ holds: [hold(), hold({ id: 2, type: "ADVISING", reason: "See your advisor" })] }));
    expect(v).toHaveLength(2);
    expect(v[0]?.message).toContain("Unpaid balance");
  });
  it("ignores cleared holds", () => {
    expect(new HoldRule().check(makeCtx({ holds: [hold({ clearedAt: NOW })] }))).toEqual([]);
  });
});

describe("DuplicateEnrollmentRule", () => {
  const rule = new DuplicateEnrollmentRule();
  it("blocks when already enrolled or waitlisted", () => {
    const course = makeCourse({ id: 5 });
    const student = makeStudent();
    expect(codes(rule.check(makeCtx({ course, activeEnrollments: [makeEnrollment(student, course)] })))).toEqual(["ALREADY_ENROLLED"]);
    expect(codes(rule.check(makeCtx({ course, activeEnrollments: [makeEnrollment(student, course, "WAITLISTED")] })))).toEqual(["ALREADY_WAITLISTED"]);
  });
  it("blocks re-taking a passed course but allows retaking a failed one", () => {
    const course = makeCourse({ code: "CS101" });
    expect(codes(rule.check(makeCtx({ course, student: makeStudent({ transcript: [g("CS101", 3)] }) })))).toEqual(["ALREADY_PASSED"]);
    expect(rule.check(makeCtx({ course, student: makeStudent({ transcript: [g("CS101", 0)] }) }))).toEqual([]);
  });
  it("passes for a fresh course", () => {
    expect(rule.check(makeCtx())).toEqual([]);
  });
});

describe("CapacityRule", () => {
  const rule = new CapacityRule();
  it("is silent while seats remain", () => {
    expect(rule.check(makeCtx({ course: makeCourse({ capacity: 30 }), enrolledCount: 29 }))).toEqual([]);
  });
  it("warns (not blocks) when full, suggesting the waitlist", () => {
    const v = rule.check(makeCtx({ course: makeCourse({ capacity: 30 }), enrolledCount: 30 }));
    expect(codes(v)).toEqual(["COURSE_FULL"]);
    expect(v[0]?.severity).toBe("warn");
    expect(v[0]?.message).toContain("waitlist");
  });
});

describe("PrerequisiteRule", () => {
  const rule = new PrerequisiteRule();
  const cs201 = makeCourse({ code: "CS201", prerequisites: [{ code: "CS101", minGrade: null }] });

  it("passes when the prerequisite is passed", () => {
    expect(rule.check(makeCtx({ course: cs201, student: makeStudent({ transcript: [g("CS101", 3)] }) }))).toEqual([]);
  });
  it("uses the specific message from the brief", () => {
    const v = rule.check(makeCtx({ course: cs201 }));
    expect(v[0]?.message).toBe("Cannot enroll in CS201: requires CS101 (not completed)");
  });
  it("says 'in progress' when the student is currently taking it", () => {
    const student = makeStudent();
    const cs101 = makeCourse({ code: "CS101" });
    const v = rule.check(makeCtx({ course: cs201, student, activeEnrollments: [makeEnrollment(student, cs101)] }));
    expect(v[0]?.message).toContain("in progress");
  });
  it("says 'not passed' for a failed attempt", () => {
    const v = rule.check(makeCtx({ course: cs201, student: makeStudent({ transcript: [g("CS101", 0)] }) }));
    expect(v[0]?.message).toContain("not passed");
  });
  it("enforces a minimum grade", () => {
    const strict = makeCourse({ code: "CS301", prerequisites: [{ code: "CS201", minGrade: 3.0 }] });
    const low = makeStudent({ transcript: [g("CS201", 2.0)] });
    expect(rule.check(makeCtx({ course: strict, student: low }))[0]?.message).toContain("minimum grade of B not met");
    expect(rule.check(makeCtx({ course: strict, student: makeStudent({ transcript: [g("CS201", 3.0)] }) }))).toEqual([]);
  });
  it("respects the grading policy direction (5.0 scale)", () => {
    const strict = makeCourse({ code: "CS301", prerequisites: [{ code: "CS201", minGrade: 2.0 }] });
    const policy = new FivePointPolicy();
    expect(rule.check(makeCtx({ course: strict, gradingPolicy: policy, student: makeStudent({ transcript: [g("CS201", 1.75)] }) }))).toEqual([]);
    expect(rule.check(makeCtx({ course: strict, gradingPolicy: policy, student: makeStudent({ transcript: [g("CS201", 2.5)] }) }))).toHaveLength(1);
  });
  it("reports every missing prerequisite", () => {
    const multi = makeCourse({ code: "CS401", prerequisites: [{ code: "CS201", minGrade: null }, { code: "MATH201", minGrade: null }] });
    expect(rule.check(makeCtx({ course: multi }))).toHaveLength(2);
  });
});

describe("CorequisiteRule", () => {
  const rule = new CorequisiteRule();
  const lab = makeCourse({ code: "CS101L", corequisites: ["CS101"] });
  it("blocks when the corequisite is neither taken nor passed", () => {
    expect(codes(rule.check(makeCtx({ course: lab })))).toEqual(["COREQUISITE_MISSING"]);
  });
  it("passes when enrolled in, waitlisted for, or already passed the corequisite", () => {
    const student = makeStudent();
    const lecture = makeCourse({ code: "CS101" });
    expect(rule.check(makeCtx({ course: lab, student, activeEnrollments: [makeEnrollment(student, lecture)] }))).toEqual([]);
    expect(rule.check(makeCtx({ course: lab, student, activeEnrollments: [makeEnrollment(student, lecture, "WAITLISTED")] }))).toEqual([]);
    expect(rule.check(makeCtx({ course: lab, student: makeStudent({ transcript: [g("CS101", 3)] }) }))).toEqual([]);
  });
  it("is satisfied by a corequisite in the same submission (this is what lets a lecture/lab pair be enrolled at all)", () => {
    expect(rule.check(makeCtx({ course: lab, pendingCourseCodes: ["CS101"] }))).toEqual([]);
    expect(codes(rule.check(makeCtx({ course: lab, pendingCourseCodes: ["MATH101"] })))).toEqual(["COREQUISITE_MISSING"]);
  });
  it("tells the student to enroll in both together", () => {
    expect(rule.check(makeCtx({ course: lab }))[0]?.message).toBe("CS101L must be taken together with CS101. Add both to your cart and enroll together.");
  });
});

describe("ScheduleConflictRule", () => {
  const rule = new ScheduleConflictRule();
  const math = makeCourse({ id: 10, code: "MATH120", meetings: meet(["MON", "WED"], hm(9), hm(10, 30)) });
  const clash = makeCourse({ id: 11, code: "CS201", meetings: meet(["MON"], hm(10), hm(11)) });

  it("blocks and names the conflicting course and time (message from the brief)", () => {
    const student = makeStudent();
    const v = rule.check(makeCtx({ course: clash, student, activeEnrollments: [makeEnrollment(student, math)] }));
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("block");
    expect(v[0]?.message).toBe("Schedule conflict with MATH120 (Mon/Wed 9:00-10:30)");
  });
  it("only warns for a clash with a class you are merely waitlisted for", () => {
    const student = makeStudent();
    const v = rule.check(makeCtx({ course: clash, student, activeEnrollments: [makeEnrollment(student, math, "WAITLISTED")] }));
    expect(v[0]?.severity).toBe("warn");
  });
  it("back-to-back classes are fine", () => {
    const student = makeStudent();
    const after = makeCourse({ id: 12, meetings: meet(["MON", "WED"], hm(10, 30), hm(12)) });
    expect(rule.check(makeCtx({ course: after, student, activeEnrollments: [makeEnrollment(student, math)] }))).toEqual([]);
  });
});

describe("UnitLimitRule", () => {
  const rule = new UnitLimitRule();
  const student = makeStudent({ maxUnits: 6 });
  const taken = makeCourse({ id: 20, units: 6 });
  const next = makeCourse({ id: 21, units: 3 });

  it("blocks when the new course would exceed the limit", () => {
    const v = rule.check(makeCtx({ course: next, student, activeEnrollments: [makeEnrollment(student, taken)] }));
    expect(codes(v)).toEqual(["UNIT_LIMIT_EXCEEDED"]);
    expect(v[0]?.message).toContain("9 units");
    expect(v[0]?.message).toContain("limit is 6");
  });
  it("allows exactly the limit", () => {
    const small = makeCourse({ id: 22, units: 3 });
    const three = makeCourse({ id: 23, units: 3 });
    expect(rule.check(makeCtx({ course: small, student, activeEnrollments: [makeEnrollment(student, three)] }))).toEqual([]);
  });
  it("an approved overload makes room", () => {
    expect(rule.check(makeCtx({ course: next, student, approvedOverloadUnits: 3, activeEnrollments: [makeEnrollment(student, taken)] }))).toEqual([]);
  });
  it("waitlisted units do not count toward the limit", () => {
    expect(rule.check(makeCtx({ course: next, student, activeEnrollments: [makeEnrollment(student, taken, "WAITLISTED")] }))).toEqual([]);
  });
});
