import request from "supertest";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/http/app.js";
import { closePool, getPool } from "../src/db/pool.js";
import { DEMO_PASSWORD, seedDatabase } from "../src/db/seed.js";
import { assertTestDatabase } from "./helpers/db.js";

/**
 * docs/demo-script.md, executed for real. Each step below carries the same number as the script, so if
 * this test passes on a fresh seed, every claim the presenter makes on stage is true.
 */
const pool = getPool();
const app = createApp({ config: { ...loadConfig(), demoMode: true }, loginLimit: 10_000 });
const q = async (sql: string, params: unknown[] = []) => (await pool.query<RowDataPacket[]>(sql, params))[0];
const cid = async (code: string) => (await q("SELECT c.id FROM courses c JOIN terms t ON t.id = c.term_id WHERE c.code = ? AND t.is_current = 1", [code]))[0]!.id as number;
async function window_(email: string) {
  const a = request.agent(app);
  await a.post("/api/auth/login").send({ email, password: DEMO_PASSWORD }).expect(200);
  return a;
}

beforeAll(async () => { assertTestDatabase(); await seedDatabase(pool); });
afterAll(closePool);

describe("demo script, start to finish", () => {
  it("runs every step on a fresh seed", async () => {
    // Step 1: sign in as Ana. Dashboard data: 2 courses, 6 of 21 units, GPA from her 3 graded courses.
    const ana = await window_("ana.reyes@student.test");
    const summary = (await ana.get("/api/me/summary").expect(200)).body;
    expect(summary).toMatchObject({ enrolledCount: 2, unitsUsed: 6, unitsLimit: 21 });
    expect(summary.gpa).toBeCloseTo(3.33, 2); // (3.5 + 3.0 + 3.5) / 3 = 10 / 3

    // Step 2: browse and filter. Full classes filter finds CS240 with its 3/3 seats and 2 waiting.
    const full = (await ana.get("/api/courses?availability=full").expect(200)).body.items;
    expect(full.map((c: { code: string }) => c.code)).toEqual(["CS240"]);
    expect(full[0]).toMatchObject({ enrolledCount: 3, capacity: 3, waitlistedCount: 2, availability: "FULL" });
    expect((await ana.get("/api/courses?q=data").expect(200)).body.items.map((c: { code: string }) => c.code)).toContain("CS102");

    // Step 3: the cart explains why. Prerequisite error, schedule conflict, then the lab pairing.
    const [cs201, phys, lab, cs102, cs250, cs240] = (await Promise.all(["CS201", "PHYS101", "PHYS101L", "CS102", "CS250", "CS240"].map(cid))) as [number, number, number, number, number, number];
    const cartCheck = (await ana.post("/api/enrollments/validate").send({ courseIds: [cs201, phys], cartCourseIds: [cs201, phys] }).expect(200)).body.results;
    expect(cartCheck[cs201].violations[0].message).toBe("Cannot enroll in CS201: requires CS102 (not completed)");
    expect(cartCheck[phys].violations.map((v: { code: string }) => v.code).sort()).toEqual(["COREQUISITE_MISSING", "SCHEDULE_CONFLICT"]);
    expect(cartCheck[phys].violations.find((v: { code: string }) => v.code === "SCHEDULE_CONFLICT").message).toBe("Schedule conflict with MATH120 (Mon/Wed 9:00-10:30)");
    const withLab = (await ana.post("/api/enrollments/validate").send({ courseIds: [phys], cartCourseIds: [phys, lab] }).expect(200)).body.results[phys];
    expect(withLab.violations.map((v: { code: string }) => v.code)).toEqual(["SCHEDULE_CONFLICT"]); // lab in the cart satisfies the corequisite
    const suggestion = (await ana.post("/api/enrollments/suggest").send({ courseIds: [phys, lab, cs102] }).expect(200)).body;
    expect(suggestion.blockedByCurrent).toEqual([{ code: "PHYS101", with: ["MATH120"] }]);

    // Step 4: remove the blocked courses, submit the rest as one cart, then join the full class's waitlist.
    const report = (await ana.post("/api/enrollments/batch").send({ courseIds: [cs102, cs250] }).expect(200)).body.results;
    expect(report.map((r: { code: string; status: string }) => [r.code, r.status])).toEqual([["CS102", "ENROLLED"], ["CS250", "ENROLLED"]]);
    const join = (await ana.post("/api/enrollments").send({ courseId: cs240 }).expect(201)).body;
    expect(join).toMatchObject({ status: "WAITLISTED", waitlistPosition: 3 });

    // Step 5: second window. Faye is #1; Ben drops CS240; Faye is promoted and notified; Ana moves up to #2.
    const faye = await window_("faye.gomez@student.test");
    const before = (await faye.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240");
    expect(before).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });
    const ben = await window_("ben.cruz@student.test");
    const bensEnrollment = (await ben.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240");
    expect(bensEnrollment.dropPreview).toBe("DROPPED"); // the confirm dialog says: no W
    const drop = (await ben.delete(`/api/enrollments/${bensEnrollment.id}`).expect(200)).body;
    expect(drop.promotions.map((p: { outcome: string }) => p.outcome)).toEqual(["PROMOTED"]);
    const after = (await faye.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240");
    expect(after.status).toBe("ENROLLED");
    expect((await faye.get("/api/me/notifications").expect(200)).body.items.some((n: { type: string }) => n.type === "PROMOTION")).toBe(true);
    expect((await ana.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240").waitlistPosition).toBe(2);
    // Optional: a drop after a course's own deadline is a W.
    const karl = await window_("karl.lim@student.test");
    const ge102 = (await karl.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "GE102");
    expect(ge102.dropPreview).toBe("WITHDRAWN");

    // Step 6: Ana's timetable, calendar export, and certificate of registration.
    const sched = (await ana.get("/api/me/schedule").expect(200)).body;
    expect(sched.blocks.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(["MATH120", "ENGL102", "CS102", "CS250"]));
    expect(sched.conflicts).toEqual([]);
    expect((await ana.get("/api/me/schedule.ics").expect(200)).text).toContain("BEGIN:VCALENDAR");
    const form = (await ana.get("/api/me/registration-form").expect(200)).body;
    expect(form.totalUnits).toBe(12); // MATH120, ENGL102, CS102, CS250 = 4 x 3
    expect(form.courses.filter((c: { status: string }) => c.status === "WAITLISTED").map((c: { code: string }) => c.code)).toEqual(["CS240"]);

    // Step 7: admin. Roster, a hold that blocks, an override with a reason, analytics.
    const admin = await window_("admin@school.test");
    const roster = (await admin.get(`/api/admin/courses/${cs240}/roster`).expect(200)).body.entries;
    expect(roster.filter((e: { status: string }) => e.status === "ENROLLED")).toHaveLength(3);
    expect(roster.filter((e: { status: string }) => e.status === "WAITLISTED").map((e: { fullName: string }) => e.fullName)).toEqual(["Gabe Hernandez", "Ana Reyes"]);
    const lia = await window_("lia.mendoza@student.test");
    const liaRow = (await q("SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'lia.mendoza@student.test'"))[0]!;
    await admin.post("/api/admin/holds").send({ studentId: liaRow.id, type: "FINANCIAL", reason: "Unpaid lab fee" }).expect(201);
    expect((await lia.post("/api/enrollments").send({ courseId: await cid("CS101") }).expect(422)).body.error.code).toBe("HOLD_ACTIVE");
    const override = (await admin.post("/api/admin/enrollments/force").send({ studentId: liaRow.id, courseId: await cid("CS101"), reason: "Fee paid in person; hold update pending" }).expect(201)).body;
    expect(override).toMatchObject({ status: "ENROLLED" });
    expect(override.warnings.map((w: { code: string }) => w.code)).toContain("HOLD_ACTIVE");
    const analytics = (await admin.get("/api/admin/analytics").expect(200)).body;
    expect(analytics.totals.waitlisted).toBe(2);
    expect(analytics.topFull[0].code).toBe("CS240");

    // Step 8: Rush Simulator. 40 virtual students, one seat: no over-enrollment. Then reset.
    const rush = (await admin.post("/api/admin/simulate/rush").send({ courseId: await cid("ENGL210"), count: 40 }).expect(200)).body;
    expect(rush).toMatchObject({ capacity: 6, enrolledBefore: 5, enrolledAfter: 6, succeeded: 1, waitlisted: 39, overEnrolled: false });
    expect((await admin.post("/api/admin/simulate/reset").expect(200)).body.removedStudents).toBe(40);

    // Step 9: the audit log tells the whole story.
    const actions = (await admin.get("/api/admin/audit?pageSize=100").expect(200)).body.actions as string[];
    expect(actions).toEqual(expect.arrayContaining(["ENROLL", "WAITLIST", "PROMOTE", "DROP", "HOLD_PLACE", "FORCE_ENROLL", "RUSH_SIMULATE", "RUSH_RESET"]));
  }, 60_000);
});
