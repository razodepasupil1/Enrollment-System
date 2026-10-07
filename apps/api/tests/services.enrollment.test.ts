import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "../src/db/pool.js";
import {
  AlreadyEnrolledError, CourseFullError, DomainError, ForbiddenError, InvalidGradeError,
  InvariantError, NotFoundError, PrerequisiteNotMetError, ScheduleConflictError,
} from "../src/errors/index.js";
import { EnrollmentService } from "../src/services/index.js";
import { World } from "./helpers/world.js";

const pool = getPool();
let w: World;
let svc: EnrollmentService;
const MW_0900: [["MON", "WED"], number, number] = [["MON", "WED"], 540, 630];
const MW_1000: [["MON"], number, number] = [["MON"], 600, 660];

beforeEach(async () => {
  w = await World.create(pool);
  svc = new EnrollmentService(pool);
});
afterAll(closePool);

describe("enroll", () => {
  it("enrolls a student, taking a seat and writing an audit row", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101", capacity: 2 });
    const r = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    expect(r.status).toBe("ENROLLED");
    expect(r.waitlistPosition).toBeNull();
    expect(await w.enrolledCount(c)).toBe(1);
    const audit = await w.rows("SELECT action, actor_user_id FROM audit_log WHERE student_id = ?", [s.studentId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "ENROLL", actor_user_id: s.userId });
  });

  it("puts a student on the waitlist when the course is full, with a position and a notification", async () => {
    const [a, b, c3] = [await w.addStudent(), await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    const rb = await svc.enroll({ studentId: b.studentId, courseId: c, actor: b.actor });
    const rc = await svc.enroll({ studentId: c3.studentId, courseId: c, actor: c3.actor });
    expect([rb.status, rb.waitlistPosition]).toEqual(["WAITLISTED", 1]);
    expect([rc.status, rc.waitlistPosition]).toEqual(["WAITLISTED", 2]);
    expect(rb.warnings.map((x) => x.code)).toEqual(["COURSE_FULL"]);
    expect(await w.enrolledCount(c)).toBe(1); // never over capacity
    const n = await w.rows("SELECT type, body FROM notifications WHERE user_id = ?", [b.userId]);
    expect(n[0]).toMatchObject({ type: "WAITLIST" });
    expect(n[0]!.body).toContain("#1");
  });

  it("refuses to waitlist when allowWaitlist is false", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    await expect(svc.enroll({ studentId: b.studentId, courseId: c, actor: b.actor, allowWaitlist: false })).rejects.toBeInstanceOf(CourseFullError);
    expect(await w.waitlistedCount(c)).toBe(0);
  });

  it("rejects a duplicate enrollment and leaves exactly one row", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    const err = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor }).catch((e) => e);
    expect(err).toBeInstanceOf(AlreadyEnrolledError);
    expect(err.code).toBe("ALREADY_ENROLLED");
    expect(err.status).toBe(409);
    expect(await w.count("SELECT COUNT(*) n FROM enrollments WHERE student_id = ?", [s.studentId])).toBe(1);
  });

  it("blocks a missing prerequisite with the specific message, writing nothing", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS201", prereq: [["CS101"]] });
    const err = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor }).catch((e) => e);
    expect(err).toBeInstanceOf(PrerequisiteNotMetError);
    expect(err.message).toBe("Cannot enroll in CS201: requires CS101 (not completed)");
    expect(await w.count("SELECT COUNT(*) n FROM enrollments")).toBe(0);
    expect(await w.count("SELECT COUNT(*) n FROM audit_log")).toBe(0);
  });

  it("allows enrollment once the prerequisite is passed, and enforces a minimum grade", async () => {
    const passed = await w.addStudent({ grades: { CS101: 3.0 } });
    const weak = await w.addStudent({ grades: { CS101: 1.0 } });
    const c = await w.addCourse({ code: "CS201", prereq: [["CS101", 2.0]] });
    expect((await svc.enroll({ studentId: passed.studentId, courseId: c, actor: passed.actor })).status).toBe("ENROLLED");
    await expect(svc.enroll({ studentId: weak.studentId, courseId: c, actor: weak.actor })).rejects.toBeInstanceOf(PrerequisiteNotMetError);
  });

  it("blocks a schedule conflict and names the course and time", async () => {
    const s = await w.addStudent();
    const math = await w.addCourse({ code: "MATH120", meetings: [MW_0900] });
    const cs = await w.addCourse({ code: "CS201", meetings: [MW_1000] });
    await svc.enroll({ studentId: s.studentId, courseId: math, actor: s.actor });
    const err = await svc.enroll({ studentId: s.studentId, courseId: cs, actor: s.actor }).catch((e) => e);
    expect(err).toBeInstanceOf(ScheduleConflictError);
    expect(err.message).toBe("Schedule conflict with MATH120 (Mon/Wed 9:00-10:30)");
  });

  it("enforces the unit limit, and an approved overload makes room", async () => {
    const s = await w.addStudent({ maxUnits: 6 });
    const [a, b, c] = [await w.addCourse({ code: "A1" }), await w.addCourse({ code: "B1" }), await w.addCourse({ code: "C1" })];
    await svc.enroll({ studentId: s.studentId, courseId: a, actor: s.actor });
    await svc.enroll({ studentId: s.studentId, courseId: b, actor: s.actor });
    const err = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor }).catch((e) => e);
    expect(err.code).toBe("UNIT_LIMIT_EXCEEDED");
    await w.approveOverload(s.studentId, 3);
    expect((await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor })).status).toBe("ENROLLED");
  });

  it("an active hold blocks enrollment until cleared", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    await w.addHold(s.studentId, "Unpaid balance");
    const err = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor }).catch((e) => e);
    expect(err.code).toBe("HOLD_ACTIVE");
    expect(err.message).toContain("Unpaid balance");
    await w.clearHolds(s.studentId);
    expect((await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor })).status).toBe("ENROLLED");
  });

  it("is blocked outside the registration window", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const late = new EnrollmentService(pool, { clock: () => new Date(w.now.getTime() + 60 * 86_400_000) });
    const err = await late.enroll({ studentId: s.studentId, courseId: c, actor: s.actor }).catch((e) => e);
    expect(err.code).toBe("REGISTRATION_CLOSED");
    const early = new EnrollmentService(pool, { clock: () => new Date(w.now.getTime() - 40 * 86_400_000) });
    expect((await early.enroll({ studentId: s.studentId, courseId: c, actor: s.actor }).catch((e) => e)).code).toBe("REGISTRATION_NOT_OPEN");
  });

  it("reports every violation at once, not just the first", async () => {
    const s = await w.addStudent();
    const math = await w.addCourse({ code: "MATH120", meetings: [MW_0900] });
    const cs = await w.addCourse({ code: "CS201", meetings: [MW_1000], prereq: [["CS101"]] });
    await svc.enroll({ studentId: s.studentId, courseId: math, actor: s.actor });
    await w.addHold(s.studentId);
    const err = await svc.enroll({ studentId: s.studentId, courseId: cs, actor: s.actor }).catch((e) => e);
    const codes = (err.details.violations as Array<{ code: string }>).map((v) => v.code).sort();
    expect(codes).toEqual(["HOLD_ACTIVE", "PREREQUISITE_NOT_MET", "SCHEDULE_CONFLICT"]);
    expect(err.message).toMatch(/and 2 more issues/);
  });

  it("a student cannot enroll someone else; unknown ids are NotFound", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101" });
    await expect(svc.enroll({ studentId: b.studentId, courseId: c, actor: a.actor })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.enroll({ studentId: a.studentId, courseId: 99999, actor: a.actor })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a failed course can be retaken, a passed one cannot", async () => {
    const s = await w.addStudent({ grades: { CS101: 0.0, MATH101: 3.0 } });
    const retake = await w.addCourse({ code: "CS101" });
    const again = await w.addCourse({ code: "MATH101" });
    expect((await svc.enroll({ studentId: s.studentId, courseId: retake, actor: s.actor })).status).toBe("ENROLLED");
    expect((await svc.enroll({ studentId: s.studentId, courseId: again, actor: s.actor }).catch((e) => e)).code).toBe("ALREADY_PASSED");
  });
});

describe("validate (dry run)", () => {
  it("returns the same verdicts as enroll but writes nothing", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    expect((await svc.validate(a.studentId, c)).outcome).toBe("ENROLL");
    await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });

    const v = await svc.validate(b.studentId, c);
    expect(v.outcome).toBe("WAITLIST");
    expect(v.wouldBeWaitlistPosition).toBe(1);

    const gated = await w.addCourse({ code: "CS201", prereq: [["CS101"]] });
    const blocked = await svc.validate(b.studentId, gated);
    expect(blocked.outcome).toBe("BLOCKED");
    expect(blocked.violations[0]!.message).toBe("Cannot enroll in CS201: requires CS101 (not completed)");

    expect(await w.count("SELECT COUNT(*) n FROM enrollments")).toBe(1); // only A's real enrollment
    expect(await w.count("SELECT COUNT(*) n FROM audit_log")).toBe(1);
  });
});

describe("drop", () => {
  it("before the deadline -> DROPPED and the seat is freed", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    const r = await svc.drop({ enrollmentId: e.enrollmentId, actor: s.actor });
    expect(r.status).toBe("DROPPED");
    expect(await w.enrolledCount(c)).toBe(0);
    expect(await w.statusOf(e.enrollmentId)).toBe("DROPPED");
  });

  it("after the term's deadline -> WITHDRAWN (a W), and the seat is still freed", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    const later = new EnrollmentService(pool, { clock: () => new Date(w.now.getTime() + 20 * 86_400_000) });
    expect((await later.drop({ enrollmentId: e.enrollmentId, actor: s.actor })).status).toBe("WITHDRAWN");
    expect(await w.enrolledCount(c)).toBe(0);
  });

  it("a course's own earlier deadline overrides the term's", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "GE102", dropDeadline: new Date(w.now.getTime() - 3 * 86_400_000) });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    expect((await svc.drop({ enrollmentId: e.enrollmentId, actor: s.actor })).status).toBe("WITHDRAWN");
  });

  it("cannot drop after the term has ended", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    const afterEnd = new EnrollmentService(pool, { clock: () => new Date(w.now.getTime() + 200 * 86_400_000) });
    expect((await afterEnd.drop({ enrollmentId: e.enrollmentId, actor: s.actor }).catch((x) => x)).code).toBe("DEADLINE_PASSED");
  });

  it("a student cannot drop someone else's enrollment (reported as not found)", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    await expect(svc.drop({ enrollmentId: e.enrollmentId, actor: b.actor })).rejects.toBeInstanceOf(NotFoundError);
    expect(await w.statusOf(e.enrollmentId)).toBe("ENROLLED");
  });

  it("cannot drop twice", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    await svc.drop({ enrollmentId: e.enrollmentId, actor: s.actor });
    expect((await svc.drop({ enrollmentId: e.enrollmentId, actor: s.actor }).catch((x) => x)).code).toBe("ILLEGAL_TRANSITION");
  });

  it("leaving the waitlist frees no seat and promotes nobody", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    const eb = await svc.enroll({ studentId: b.studentId, courseId: c, actor: b.actor });
    const r = await svc.drop({ enrollmentId: eb.enrollmentId, actor: b.actor });
    expect(r.status).toBe("DROPPED");
    expect(r.promotions).toEqual([]);
    expect(await w.enrolledCount(c)).toBe(1);
    expect((await w.rows("SELECT action FROM audit_log WHERE student_id = ? ORDER BY id", [b.studentId])).map((x) => x.action)).toEqual(["WAITLIST", "LEAVE_WAITLIST"]);
  });
});

describe("waitlist promotion", () => {
  it("promotes the earliest waitlisted student on drop, with notification and audit; positions shift up", async () => {
    const [a, b, c3] = [await w.addStudent(), await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    const ea = await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    const eb = await svc.enroll({ studentId: b.studentId, courseId: c, actor: b.actor });
    const ec = await svc.enroll({ studentId: c3.studentId, courseId: c, actor: c3.actor });
    expect([eb.waitlistPosition, ec.waitlistPosition]).toEqual([1, 2]);

    const r = await svc.drop({ enrollmentId: ea.enrollmentId, actor: a.actor });
    expect(r.promotions).toHaveLength(1);
    expect(r.promotions[0]).toMatchObject({ studentId: b.studentId, outcome: "PROMOTED" });
    expect(await w.statusOf(eb.enrollmentId)).toBe("ENROLLED");
    expect(await w.statusOf(ec.enrollmentId)).toBe("WAITLISTED");
    expect(await w.enrolledCount(c)).toBe(1);

    const [pos] = await w.rows("SELECT COUNT(*) + 1 pos FROM enrollments WHERE course_id = ? AND status = 'WAITLISTED' AND id < ?", [c, ec.enrollmentId]);
    expect(Number(pos!.pos)).toBe(1); // C moved from #2 to #1 without any renumbering
    const note = await w.rows("SELECT type FROM notifications WHERE user_id = ? AND type = 'PROMOTION'", [b.userId]);
    expect(note).toHaveLength(1);
    expect(await w.count("SELECT COUNT(*) n FROM audit_log WHERE action = 'PROMOTE' AND student_id = ?", [b.studentId])).toBe(1);
  });

  it("skips (and notifies) a waitlisted student who no longer qualifies, keeping their place, and promotes the next", async () => {
    const [a, b, c3] = [await w.addStudent(), await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    const ea = await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    const eb = await svc.enroll({ studentId: b.studentId, courseId: c, actor: b.actor });
    const ec = await svc.enroll({ studentId: c3.studentId, courseId: c, actor: c3.actor });
    await w.addHold(b.studentId, "Library fine"); // B gets a hold while waiting

    const r = await svc.drop({ enrollmentId: ea.enrollmentId, actor: a.actor });
    expect(r.promotions.map((p) => [p.studentId, p.outcome])).toEqual([[b.studentId, "SKIPPED"], [c3.studentId, "PROMOTED"]]);
    expect(r.promotions[0]!.reasons[0]!.code).toBe("HOLD_ACTIVE");
    expect(await w.statusOf(eb.enrollmentId)).toBe("WAITLISTED"); // still in line
    expect(await w.statusOf(ec.enrollmentId)).toBe("ENROLLED");
    const note = await w.rows("SELECT body FROM notifications WHERE user_id = ? AND type = 'WAITLIST_SKIPPED'", [b.userId]);
    expect(note[0]!.body).toContain("Library fine");
  });

  it("fills several seats when an admin raises capacity", async () => {
    const students = [await w.addStudent(), await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    for (const s of students) await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    expect(await w.waitlistedCount(c)).toBe(2);
    await w.setCapacity(c, 3);
    const promoted = await svc.fillSeatsFromWaitlist(c, w.admin);
    expect(promoted.filter((p) => p.outcome === "PROMOTED")).toHaveLength(2);
    expect(await w.enrolledCount(c)).toBe(3);
    expect(await w.waitlistedCount(c)).toBe(0);
  });

  it("promotion still works after the registration window has closed (add/drop period)", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    const ea = await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    const eb = await svc.enroll({ studentId: b.studentId, courseId: c, actor: b.actor });
    // 35 days later: window closed (30d) but still before the drop deadline? deadline is +14d, so use a
    // service whose clock is after close; the drop itself becomes a WITHDRAW but the promotion must proceed.
    const later = new EnrollmentService(pool, { clock: () => new Date(w.now.getTime() + 35 * 86_400_000) });
    await later.drop({ enrollmentId: ea.enrollmentId, actor: a.actor });
    expect(await w.statusOf(eb.enrollmentId)).toBe("ENROLLED");
  });
});

describe("enrollBatch (cart submit)", () => {
  it("partial success: good items enroll, bad ones are rejected with reasons, nothing is rolled back", async () => {
    const s = await w.addStudent();
    const ok = await w.addCourse({ code: "CS101" });
    const gated = await w.addCourse({ code: "CS201", prereq: [["CS101"]] });
    const ok2 = await w.addCourse({ code: "ENGL101" });
    const results = await svc.enrollBatch({ studentId: s.studentId, courseIds: [ok, gated, ok2], actor: s.actor });
    expect(results.map((r) => [r.code, r.status])).toEqual([["CS101", "ENROLLED"], ["CS201", "REJECTED"], ["ENGL101", "ENROLLED"]]);
    expect(results[1]!.error!.code).toBe("PREREQUISITE_NOT_MET");
    expect(await w.count("SELECT COUNT(*) n FROM enrollments WHERE student_id = ? AND status = 'ENROLLED'", [s.studentId])).toBe(2);
  });

  it("a mutual lecture/lab pair enrolls together in either cart order", async () => {
    for (const order of ["lab-first", "lecture-first"] as const) {
      w = await World.create(pool);
      svc = new EnrollmentService(pool);
      const s = await w.addStudent();
      const lecture = await w.addCourse({ code: "PHYS101", coreq: ["PHYS101L"], units: 3 });
      const lab = await w.addCourse({ code: "PHYS101L", coreq: ["PHYS101"], units: 1 });
      const ids = order === "lab-first" ? [lab, lecture] : [lecture, lab];
      const results = await svc.enrollBatch({ studentId: s.studentId, courseIds: ids, actor: s.actor });
      expect(results.map((r) => r.status), order).toEqual(["ENROLLED", "ENROLLED"]);
    }
  });

  it("enrolling in only one half of a mutual pair is refused with a clear message", async () => {
    const s = await w.addStudent();
    const lecture = await w.addCourse({ code: "PHYS101", coreq: ["PHYS101L"] });
    await w.addCourse({ code: "PHYS101L", coreq: ["PHYS101"] });
    const err = await svc.enroll({ studentId: s.studentId, courseId: lecture, actor: s.actor }).catch((e) => e);
    expect(err.code).toBe("COREQUISITE_MISSING");
    expect(err.message).toContain("Add both to your cart");
  });

  it("the dry run understands the cart: the pair validates together but not alone", async () => {
    const s = await w.addStudent();
    const lecture = await w.addCourse({ code: "PHYS101", coreq: ["PHYS101L"] });
    await w.addCourse({ code: "PHYS101L", coreq: ["PHYS101"] });
    expect((await svc.validate(s.studentId, lecture)).outcome).toBe("BLOCKED");
    expect((await svc.validate(s.studentId, lecture, ["PHYS101L"])).outcome).toBe("ENROLL");
  });

  it("rolls the lab back if its lecture fails, so no lab is left enrolled alone", async () => {
    const s = await w.addStudent();
    // The lecture has a prerequisite this student lacks; the lab has none.
    const lecture = await w.addCourse({ code: "PHYS101", coreq: ["PHYS101L"], prereq: [["MATH101"]] });
    const lab = await w.addCourse({ code: "PHYS101L", coreq: ["PHYS101"], capacity: 5 });
    const results = await svc.enrollBatch({ studentId: s.studentId, courseIds: [lab, lecture], actor: s.actor });
    expect(results.map((r) => [r.code, r.status])).toEqual([["PHYS101L", "REJECTED"], ["PHYS101", "REJECTED"]]);
    expect(results[0]!.error!.code).toBe("COREQUISITE_MISSING");
    expect(results[1]!.error!.code).toBe("PREREQUISITE_NOT_MET");
    // The lab really was enrolled for a moment, then undone: seat freed, status DROPPED (not a "W"), audited.
    expect(await w.enrolledCount(lab)).toBe(0);
    expect((await w.rows("SELECT status FROM enrollments WHERE course_id = ?", [lab])).map((r) => r.status)).toEqual(["DROPPED"]);
    expect(await w.count("SELECT COUNT(*) n FROM audit_log WHERE action = 'ROLLBACK'")).toBe(1);
  });

  it("a full course in the cart is waitlisted, not rejected", async () => {
    const [a, s] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    const [r] = await svc.enrollBatch({ studentId: s.studentId, courseIds: [c], actor: s.actor });
    expect([r!.status, r!.waitlistPosition]).toEqual(["WAITLISTED", 1]);
  });

  it("duplicate ids in the cart are processed once", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const results = await svc.enrollBatch({ studentId: s.studentId, courseIds: [c, c], actor: s.actor });
    expect(results).toHaveLength(1);
  });
});

describe("forceEnroll (admin override)", () => {
  it("bypasses prerequisites and holds, and records the reason and the rules overridden", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS201", prereq: [["CS101"]] });
    await w.addHold(s.studentId);
    const r = await svc.forceEnroll({ studentId: s.studentId, courseId: c, reason: "Dean approval on file", actor: w.admin });
    expect(r.status).toBe("ENROLLED");
    const [a] = await w.rows("SELECT action, details FROM audit_log WHERE action = 'FORCE_ENROLL'");
    const details = typeof a!.details === "string" ? JSON.parse(a!.details) : a!.details;
    expect(details.reason).toBe("Dean approval on file");
    expect(details.overriddenRules.map((x: { code: string }) => x.code).sort()).toEqual(["HOLD_ACTIVE", "PREREQUISITE_NOT_MET"]);
  });

  it("requires admin and a real reason", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    await expect(svc.forceEnroll({ studentId: s.studentId, courseId: c, reason: "because", actor: s.actor })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.forceEnroll({ studentId: s.studentId, courseId: c, reason: "  ", actor: w.admin })).rejects.toBeInstanceOf(InvariantError);
  });

  it("can NEVER over-enroll: a full course must have its capacity raised first", async () => {
    const [a, b] = [await w.addStudent(), await w.addStudent()];
    const c = await w.addCourse({ code: "CS101", capacity: 1 });
    await svc.enroll({ studentId: a.studentId, courseId: c, actor: a.actor });
    await expect(svc.forceEnroll({ studentId: b.studentId, courseId: c, reason: "VIP request", actor: w.admin })).rejects.toBeInstanceOf(CourseFullError);
    expect(await w.enrolledCount(c)).toBe(1);
  });
});

describe("recordGrade", () => {
  it("passing grade -> COMPLETED, posts a notification, audited", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    const r = await svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 3.5, actor: w.instructor });
    expect(r).toEqual({ status: "COMPLETED", grade: 3.5 });
    expect(await w.statusOf(e.enrollmentId)).toBe("COMPLETED");
    expect(await w.count("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND type = 'GRADE'", [s.userId])).toBe(1);
    expect(await w.count("SELECT COUNT(*) n FROM audit_log WHERE action = 'GRADE'")).toBe(1);
  });

  it("failing grade -> FAILED; invalid grade is rejected and nothing changes", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    await expect(svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 7, actor: w.instructor })).rejects.toBeInstanceOf(InvalidGradeError);
    expect(await w.statusOf(e.enrollmentId)).toBe("ENROLLED");
    expect((await svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 0, actor: w.instructor })).status).toBe("FAILED");
  });

  it("only the course's own instructor (or an admin) may grade; students never", async () => {
    const s = await w.addStudent();
    const c = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c, actor: s.actor });
    const otherInstructor = { userId: 9999, role: "instructor" as const, instructorId: w.instructorId + 1 };
    await expect(svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 3, actor: otherInstructor })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 3, actor: s.actor })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 3, actor: w.admin })).status).toBe("COMPLETED");
  });

  it("a graded course counts toward the transcript and satisfies later prerequisites", async () => {
    const s = await w.addStudent();
    const c1 = await w.addCourse({ code: "CS101" });
    const e = await svc.enroll({ studentId: s.studentId, courseId: c1, actor: s.actor });
    await svc.recordGrade({ enrollmentId: e.enrollmentId, grade: 3, actor: w.instructor });
    await w.addPastGrade(s.studentId, "XX", 4.0); // unrelated history must not interfere
    // CS101 is now COMPLETED in the CURRENT term; a course requiring it is open to the student.
    const c2 = await w.addCourse({ code: "CS201", prereq: [["CS101"]] });
    expect((await svc.enroll({ studentId: s.studentId, courseId: c2, actor: s.actor })).status).toBe("ENROLLED");
  });
});

describe("error contract", () => {
  it("every expected failure is a DomainError with a stable code and an HTTP status", async () => {
    const s = await w.addStudent();
    const err = await svc.enroll({ studentId: s.studentId, courseId: 424242, actor: s.actor }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect([err.code, err.status]).toEqual(["NOT_FOUND", 404]);
  });
});
