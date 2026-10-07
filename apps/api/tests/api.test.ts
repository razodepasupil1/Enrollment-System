import request from "supertest";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/http/app.js";
import { closePool, getPool } from "../src/db/pool.js";
import { DEMO_PASSWORD, seedDatabase } from "../src/db/seed.js";
import { assertTestDatabase } from "./helpers/db.js";

const pool = getPool();
const config = { ...loadConfig(), demoMode: true };
const app = createApp({ config, loginLimit: 10_000 });

const q = async (sql: string, params: unknown[] = []) => (await pool.query<RowDataPacket[]>(sql, params))[0];
const cid = async (code: string) => (await q("SELECT c.id FROM courses c JOIN terms t ON t.id = c.term_id WHERE c.code = ? AND t.is_current = 1", [code]))[0]!.id as number;
const enrId = async (studentEmail: string, code: string) =>
  (await q(`SELECT e.id FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
            JOIN courses c ON c.id = e.course_id JOIN terms t ON t.id = c.term_id
            WHERE u.email = ? AND c.code = ? AND t.is_current = 1 AND e.status IN ('ENROLLED','WAITLISTED') LIMIT 1`, [studentEmail, code]))[0]!.id as number;

/** A browser-like session: the agent keeps the httpOnly cookie between requests. */
async function as(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email, password: DEMO_PASSWORD }).expect(200);
  return agent;
}
const ANA = "ana.reyes@student.test";

beforeEach(async () => { assertTestDatabase(); await seedDatabase(pool); });
afterAll(closePool);

describe("authentication & session cookie", () => {
  it("login sets an httpOnly, SameSite=Lax cookie and returns the user without any password data", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: ANA, password: DEMO_PASSWORD }).expect(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/enroll_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.user).toMatchObject({ email: ANA, role: "student" });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|\$2[aby]\$/i);
  });

  it("the Secure flag follows COOKIE_SECURE", async () => {
    const secureApp = createApp({ config: { ...config, cookieSecure: true }, loginLimit: 100 });
    const res = await request(secureApp).post("/api/auth/login").send({ email: ANA, password: DEMO_PASSWORD });
    expect(String(res.headers["set-cookie"])).toMatch(/Secure/);
  });

  it("wrong password and unknown email give the same 401 (no account discovery)", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email: ANA, password: "nope-nope" }).expect(401);
    const unknown = await request(app).post("/api/auth/login").send({ email: "ghost@nowhere.test", password: "nope-nope" }).expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("UNAUTHORIZED");
  });

  it("/auth/me needs the cookie; a tampered cookie is rejected; logout clears it", async () => {
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").set("Cookie", "enroll_session=not.a.jwt").expect(401);
    const agent = await as(ANA);
    expect((await agent.get("/api/auth/me").expect(200)).body.user.email).toBe(ANA);
    await agent.post("/api/auth/logout").expect(200);
    await agent.get("/api/auth/me").expect(401);
  });

  it("login is rate limited", async () => {
    const limited = createApp({ config, loginLimit: 3 });
    for (let i = 0; i < 3; i++) await request(limited).post("/api/auth/login").send({ email: ANA, password: "bad-bad-bad" }).expect(401);
    const res = await request(limited).post("/api/auth/login").send({ email: ANA, password: "bad-bad-bad" }).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("demo login works only in DEMO_MODE, and demo accounts are hidden otherwise", async () => {
    await request(app).post("/api/auth/demo-login").send({ email: "admin@school.test" }).expect(200);
    expect((await request(app).get("/api/auth/demo-accounts").expect(200)).body.accounts.length).toBeGreaterThan(5);
    const prod = createApp({ config: { ...config, demoMode: false }, loginLimit: 100 });
    await request(prod).post("/api/auth/demo-login").send({ email: "admin@school.test" }).expect(403);
    expect((await request(prod).get("/api/auth/demo-accounts").expect(200)).body.accounts).toEqual([]);
  });

  it("sends security headers, never caches API responses, and hides the framework", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("authorization", () => {
  it("anonymous requests get 401 with the standard error shape", async () => {
    const res = await request(app).get("/api/courses").expect(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Please sign in." } });
    await request(app).post("/api/enrollments").send({ courseId: 1 }).expect(401);
    await request(app).delete("/api/enrollments/1").expect(401);
  });

  it("each role is fenced to its own area", async () => {
    const student = await as(ANA);
    const instructor = await as("instructor@school.test");
    const admin = await as("admin@school.test");
    await student.get("/api/admin/analytics").expect(403);
    await student.get("/api/instructor/courses").expect(403);
    await instructor.post("/api/enrollments").send({ courseId: await cid("CS101") }).expect(403);
    await instructor.get("/api/admin/audit").expect(403);
    await admin.get("/api/me/summary").expect(403);
    await admin.post("/api/enrollments").send({ courseId: await cid("CS101") }).expect(403);
  });

  it("a student cannot act as someone else: a client-sent studentId is ignored", async () => {
    const ana = await as(ANA);
    const [ben] = await q("SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'ben.cruz@student.test'");
    const res = await ana.post("/api/enrollments").send({ courseId: await cid("CS250"), studentId: ben!.id }).expect(201);
    const [row] = await q("SELECT s.student_number, u.email FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id WHERE e.id = ?", [res.body.enrollmentId]);
    expect(row!.email).toBe(ANA);
  });

  it("a student cannot drop another student's enrollment (reported as not found)", async () => {
    const ana = await as(ANA);
    const bens = await enrId("ben.cruz@student.test", "CS201");
    const res = await ana.delete(`/api/enrollments/${bens}`).expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect((await q("SELECT status FROM enrollments WHERE id = ?", [bens]))[0]!.status).toBe("ENROLLED");
  });

  it("an instructor sees only their own classes' rosters; an admin sees any", async () => {
    const math = await as("jose.villanueva@school.test");
    const cs = await cid("CS240");
    await math.get(`/api/instructor/courses/${cs}/roster`).expect(403);
    await (await as("admin@school.test")).get(`/api/admin/courses/${cs}/roster`).expect(200);
    await (await as("instructor@school.test")).get(`/api/instructor/courses/${cs}/roster`).expect(200);
  });

  it("notifications are scoped to their owner", async () => {
    const ana = await as(ANA);
    const faye = await as("faye.gomez@student.test");
    const fayeNote = (await faye.get("/api/me/notifications").expect(200)).body.items[0];
    await ana.patch(`/api/notifications/${fayeNote.id}/read`).expect(200); // Ana tries Faye's notification
    expect((await q("SELECT is_read FROM notifications WHERE id = ?", [fayeNote.id]))[0]!.is_read).toBe(0);
    await faye.patch(`/api/notifications/${fayeNote.id}/read`).expect(200);
    expect((await q("SELECT is_read FROM notifications WHERE id = ?", [fayeNote.id]))[0]!.is_read).toBe(1);
  });
});

describe("validation & error contract", () => {
  it("rejects malformed input with 400 VALIDATION_ERROR and field issues", async () => {
    const ana = await as(ANA);
    const bad = await ana.post("/api/enrollments").send({ courseId: "abc" }).expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(bad.body.error.details.issues.length).toBeGreaterThan(0);
    await ana.get("/api/courses?pageSize=1000").expect(400);
    await ana.get("/api/courses?day=FUNDAY").expect(400);
    await ana.get("/api/courses/not-a-number").expect(400);
  });

  it("invalid JSON and unknown routes use the same shape", async () => {
    const ana = await as(ANA);
    const res = await ana.post("/api/enrollments").set("Content-Type", "application/json").send("{oops").expect(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
    expect((await ana.get("/api/nope").expect(404)).body.error.code).toBe("NOT_FOUND");
  });
});

describe("catalog", () => {
  it("lists the current term, paginated, with seat counts", async () => {
    const ana = await as(ANA);
    const p1 = (await ana.get("/api/courses").expect(200)).body;
    expect(p1.total).toBe(25);
    expect(p1.items).toHaveLength(12);
    expect(p1.items[0].code <= p1.items[1].code).toBe(true);
    const p3 = (await ana.get("/api/courses?page=3").expect(200)).body;
    expect(p3.items).toHaveLength(1);
    const cs240 = (await ana.get("/api/courses?q=CS240").expect(200)).body.items[0];
    expect(cs240).toMatchObject({ capacity: 3, enrolledCount: 3, waitlistedCount: 2, availableSeats: 0, availability: "FULL" });
  });

  it("filters by department, day, units, availability and text", async () => {
    const ana = await as(ANA);
    const get = async (qs: string) => (await ana.get(`/api/courses?${qs}`).expect(200)).body;
    expect((await get("department=BUS")).items.map((c: { code: string }) => c.code).sort()).toEqual(["BUS101", "BUS201", "BUS210"]);
    expect((await get("day=SAT")).items.every((c: { meetings: Array<{ day: string }> }) => c.meetings.some((m) => m.day === "SAT"))).toBe(true);
    expect((await get("minUnits=1&maxUnits=1")).items.map((c: { code: string }) => c.code)).toEqual(["PHYS101L"]);
    const full = (await get("availability=full")).items.map((c: { code: string }) => c.code);
    expect(full).toContain("CS240");
    expect(full).not.toContain("CS101");
    expect((await get("availability=open")).items.map((c: { code: string }) => c.code)).not.toContain("CS240");
    expect((await get("q=data")).items.map((c: { code: string }) => c.code)).toContain("CS102");
  });

  it("sorts by remaining seats", async () => {
    const ana = await as(ANA);
    const items = (await ana.get("/api/courses?sort=seats&pageSize=3").expect(200)).body.items;
    expect(items[0].availableSeats).toBeGreaterThanOrEqual(items[1].availableSeats);
  });

  it("treats % and SQL text in the search box as plain text", async () => {
    const ana = await as(ANA);
    expect((await ana.get("/api/courses?q=%25").expect(200)).body.total).toBe(0); // a literal "%", not a wildcard
    await ana.get(`/api/courses?q=${encodeURIComponent("'; DROP TABLE courses;--")}`).expect(200);
    expect((await q("SELECT COUNT(*) n FROM courses"))[0]!.n).toBeGreaterThan(30);
  });

  it("marks the student's own enrollments and returns course detail with prerequisite titles", async () => {
    const ana = await as(ANA);
    const m = (await ana.get("/api/courses?q=MATH120").expect(200)).body.items[0];
    expect(m.mine).toMatchObject({ status: "ENROLLED" });
    const detail = (await ana.get(`/api/courses/${await cid("CS201")}`).expect(200)).body;
    expect(detail.prerequisites).toEqual([{ code: "CS102", minGrade: null }]);
    expect(detail.prerequisiteTitles.CS102).toBe("Data Structures");
    await ana.get("/api/courses/999999").expect(404);
  });
});

describe("enrolling: the demo script, through HTTP", () => {
  it("dry run explains WHY: a missing prerequisite and a schedule conflict, with the exact messages", async () => {
    const ana = await as(ANA);
    const [cs201, phys, lab, cs240] = await Promise.all([cid("CS201"), cid("PHYS101"), cid("PHYS101L"), cid("CS240")]);
    const { results } = (await ana.post("/api/enrollments/validate").send({ courseIds: [cs201, phys, cs240] }).expect(200)).body;
    expect(results[cs201].outcome).toBe("BLOCKED");
    expect(results[cs201].violations[0].message).toBe("Cannot enroll in CS201: requires CS102 (not completed)");
    expect(results[phys].violations.map((v: { code: string }) => v.code).sort()).toEqual(["COREQUISITE_MISSING", "SCHEDULE_CONFLICT"]);
    expect(results[phys].violations.find((v: { code: string }) => v.code === "SCHEDULE_CONFLICT").message).toBe("Schedule conflict with MATH120 (Mon/Wed 9:00-10:30)");
    expect(results[cs240]).toMatchObject({ outcome: "WAITLIST", wouldBeWaitlistPosition: 3 });

    const rowsBefore = (await q("SELECT COUNT(*) n FROM enrollments"))[0]!.n;
    const auditBefore = (await q("SELECT COUNT(*) n FROM audit_log"))[0]!.n;
    const withCart = (await ana.post("/api/enrollments/validate").send({ courseIds: [phys], cartCourseIds: [lab] }).expect(200)).body.results[phys];
    expect(withCart.violations.map((v: { code: string }) => v.code)).toEqual(["SCHEDULE_CONFLICT"]); // lecture/lab pair satisfied by the cart
    expect((await q("SELECT COUNT(*) n FROM enrollments"))[0]!.n).toBe(rowsBefore); // a dry run wrote nothing
    expect((await q("SELECT COUNT(*) n FROM audit_log"))[0]!.n).toBe(auditBefore); // and logged nothing
  });

  it("enrolls, auto-waitlists a full course, and refuses duplicates and prerequisite gaps", async () => {
    const ana = await as(ANA);
    const ok = await ana.post("/api/enrollments").send({ courseId: await cid("CS250") }).expect(201);
    expect(ok.body.status).toBe("ENROLLED");
    const wl = await ana.post("/api/enrollments").send({ courseId: await cid("CS240") }).expect(201);
    expect(wl.body).toMatchObject({ status: "WAITLISTED", waitlistPosition: 3 });
    const dup = await ana.post("/api/enrollments").send({ courseId: await cid("CS240") }).expect(409);
    expect(dup.body.error.code).toBe("ALREADY_WAITLISTED");
    const pre = await ana.post("/api/enrollments").send({ courseId: await cid("CS201") }).expect(422);
    expect(pre.body.error.code).toBe("PREREQUISITE_NOT_MET");
    expect(pre.body.error.details.violations[0].message).toContain("requires CS102");
  });

  it("allowWaitlist=false refuses a full course with 409 COURSE_FULL", async () => {
    const ana = await as(ANA);
    const res = await ana.post("/api/enrollments").send({ courseId: await cid("CS240"), allowWaitlist: false }).expect(409);
    expect(res.body.error.code).toBe("COURSE_FULL");
  });

  it("cart submit gives a per-item report (partial success)", async () => {
    const ana = await as(ANA);
    const ids = [await cid("CS102"), await cid("CS201"), await cid("ENGL210")];
    const { results } = (await ana.post("/api/enrollments/batch").send({ courseIds: ids }).expect(200)).body;
    expect(results.map((r: { code: string; status: string }) => [r.code, r.status])).toEqual([["CS102", "ENROLLED"], ["CS201", "REJECTED"], ["ENGL210", "ENROLLED"]]);
    expect(results[1].error.message).toBe("Cannot enroll in CS201: requires CS102 (in progress)");
    expect((await q("SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND status = 'ENROLLED'", [ids[2]]))[0]!.n).toBe(6); // the last seat is taken
  });

  it("drop -> promotion: the next student on the waitlist is enrolled and notified (the 'second window')", async () => {
    const ben = await as("ben.cruz@student.test");
    const faye = await as("faye.gomez@student.test");
    const gabe = await as("gabe.hernandez@student.test");
    expect((await faye.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240").waitlistPosition).toBe(1);

    const drop = await ben.delete(`/api/enrollments/${await enrId("ben.cruz@student.test", "CS240")}`).expect(200);
    expect(drop.body.status).toBe("DROPPED");
    expect(drop.body.promotions).toHaveLength(1);
    expect(drop.body.promotions[0].outcome).toBe("PROMOTED");

    const fayeEnr = (await faye.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240");
    expect(fayeEnr.status).toBe("ENROLLED");
    const gabeEnr = (await gabe.get("/api/me/enrollments").expect(200)).body.enrollments.find((e: { course: { code: string } }) => e.course.code === "CS240");
    expect(gabeEnr.waitlistPosition).toBe(1); // moved up from #2
    const notes = (await faye.get("/api/me/notifications").expect(200)).body;
    expect(notes.items.some((n: { type: string }) => n.type === "PROMOTION")).toBe(true);
    expect(notes.unreadCount).toBeGreaterThanOrEqual(2);
  });

  it("dropping after a course's own deadline gives a W that shows on the transcript; the confirm preview says so first", async () => {
    const karl = await as("karl.lim@student.test");
    const list = (await karl.get("/api/me/enrollments").expect(200)).body.enrollments;
    const ge102 = list.find((e: { course: { code: string } }) => e.course.code === "GE102");
    const cs250 = list.find((e: { course: { code: string } }) => e.course.code === "CS250");
    expect(ge102.dropPreview).toBe("WITHDRAWN");
    expect(cs250.dropPreview).toBe("DROPPED");
    expect((await karl.delete(`/api/enrollments/${ge102.id}`).expect(200)).body.status).toBe("WITHDRAWN");
    const t = (await karl.get("/api/me/transcript").expect(200)).body;
    const current = t.terms.find((x: { termName: string }) => x.termName === "Fall 2026");
    expect(current.courses.find((c: { code: string }) => c.code === "GE102").display).toBe("W");
    expect(current.courses.find((c: { code: string }) => c.code === "CS250").display).toBe("IP");
  });

  it("a hold blocks enrollment with its reason until an admin clears it", async () => {
    const hana = await as("hana.ignacio@student.test");
    const admin = await as("admin@school.test");
    const course = await cid("GE101");
    const blocked = await hana.post("/api/enrollments").send({ courseId: course }).expect(422);
    expect(blocked.body.error.code).toBe("HOLD_ACTIVE");
    expect(blocked.body.error.message).toContain("Unpaid tuition balance");
    const holdId = (await admin.get("/api/admin/holds?active=1").expect(200)).body.holds[0].id;
    await admin.post(`/api/admin/holds/${holdId}/clear`).expect(200);
    await hana.post("/api/enrollments").send({ courseId: course }).expect(201);
    expect((await hana.get("/api/me/notifications").expect(200)).body.items.some((n: { type: string }) => n.type === "HOLD_CLEARED")).toBe(true);
  });

  it("the unit limit blocks, and an approved overload request lifts it", async () => {
    const ivan = await as("ivan.jimenez@student.test");
    const admin = await as("admin@school.test");
    const course = await cid("GE101");
    expect((await ivan.post("/api/enrollments").send({ courseId: course }).expect(422)).body.error.code).toBe("UNIT_LIMIT_EXCEEDED");
    const pending = (await admin.get("/api/admin/overload-requests?status=PENDING").expect(200)).body.requests;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ studentName: "Ivan Jimenez", extraUnits: 3, currentUnits: 15, maxUnits: 15 });
    await admin.post(`/api/admin/overload-requests/${pending[0].id}/decision`).send({ approve: true, note: "Approved by the dean" }).expect(200);
    await ivan.post("/api/enrollments").send({ courseId: course }).expect(201);
    expect((await ivan.get("/api/me/summary").expect(200)).body).toMatchObject({ unitsUsed: 18, unitsLimit: 18, approvedOverloadUnits: 3 });
    await admin.post(`/api/admin/overload-requests/${pending[0].id}/decision`).send({ approve: false }).expect(404); // already decided
  });

  it("students can request an overload once while one is pending, with validation", async () => {
    const lia = await as("lia.mendoza@student.test");
    await lia.post("/api/me/overload-requests").send({ extraUnits: 3, reason: "short" }).expect(400);
    await lia.post("/api/me/overload-requests").send({ extraUnits: 3, reason: "I want to graduate a semester early." }).expect(201);
    const again = await lia.post("/api/me/overload-requests").send({ extraUnits: 3, reason: "I want to graduate a semester early." }).expect(409);
    expect(again.body.error.message).toMatch(/pending/);
    expect((await lia.get("/api/me/overload-requests").expect(200)).body.requests).toHaveLength(1);
  });
});

describe("schedule suggester", () => {
  it("finds the conflict-free combinations in a cart, and clashes with classes you already have", async () => {
    const ana = await as(ANA);
    const [m101, bus210, cs102, phys] = await Promise.all([cid("MATH101"), cid("BUS210"), cid("CS102"), cid("PHYS101")]);
    // MATH101 and BUS210 share a time slot; CS102 fits with either. PHYS101 clashes with Ana's enrolled MATH120.
    const res = (await ana.post("/api/enrollments/suggest").send({ courseIds: [m101, bus210, cs102, phys] }).expect(200)).body;
    expect(res.conflicts.map((c: { a: string; b: string }) => [c.a, c.b])).toEqual([["MATH101", "BUS210"]]);
    expect(res.blockedByCurrent).toEqual([{ code: "PHYS101", with: ["MATH120"] }]);
    expect(res.combinations.map((c: { codes: string[] }) => [...c.codes].sort())).toEqual([["BUS210", "CS102"], ["CS102", "MATH101"]]);
    expect(res.combinations[0].units).toBe(6);
    expect(res.conflictFree).toBe(false);
    expect(res.minimalRemovals).toBe(1);
    expect((await q("SELECT COUNT(*) n FROM enrollments WHERE student_id = (SELECT id FROM students WHERE student_number = '2025-0001')"))[0]!.n).toBe(5); // read-only
  });

  it("says so when everything fits, and validates its input", async () => {
    const ana = await as(ANA);
    const res = (await ana.post("/api/enrollments/suggest").send({ courseIds: [await cid("CS102"), await cid("CS250")] }).expect(200)).body;
    expect(res).toMatchObject({ conflictFree: true, minimalRemovals: 0 });
    expect(res.combinations).toHaveLength(1);
    await ana.post("/api/enrollments/suggest").send({ courseIds: [await cid("CS102")] }).expect(400);
    await (await as("admin@school.test")).post("/api/enrollments/suggest").send({ courseIds: [1, 2] }).expect(403);
  });
});

describe("student pages", () => {
  it("summary, schedule (with .ics export), registration form", async () => {
    const dan = await as("dan.garcia@student.test");
    expect((await dan.get("/api/me/summary").expect(200)).body).toMatchObject({ unitsUsed: 9, unitsLimit: 9, enrolledCount: 3 });

    const ana = await as(ANA);
    const sched = (await ana.get("/api/me/schedule").expect(200)).body;
    expect(sched.termName).toBe("Fall 2026");
    expect(sched.blocks.map((b: { code: string }) => b.code)).toContain("MATH120");
    expect(sched.conflicts).toEqual([]);

    const ics = await ana.get("/api/me/schedule.ics").expect(200);
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.headers["content-disposition"]).toMatch(/attachment/);
    expect(ics.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics.text).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=\d{8}T235959/);
    expect(ics.text).toContain("SUMMARY:MATH120 Discrete Mathematics");
    expect(ics.text.split("\r\n").every((l: string) => Buffer.byteLength(l) <= 75)).toBe(true);

    const form = (await ana.get("/api/me/registration-form").expect(200)).body;
    expect(form.totalUnits).toBe(6);
    expect(form.courses.map((c: { code: string }) => c.code).sort()).toEqual(["ENGL102", "MATH120"]);
  });

  it("transcript: unit-weighted GPA, standing, and a note on how the policy reads", async () => {
    const jaya = await as("jaya.katigbak@student.test");
    const t = (await jaya.get("/api/me/transcript").expect(200)).body;
    // Jaya's grades: 3.5 3.5 3.0 3.0 3.5 3.0 3.5 3.0 3.0 over 3 units each = 29.0/9 = 3.22
    expect(t.cumulativeGpa).toBeCloseTo(3.22, 2);
    expect(t.standing).toBe("GOOD_STANDING");
    expect(t.unitsEarned).toBe(27);
    expect(t.terms[0].termName).toBe("Fall 2026");
    expect(t.terms[0].courses.every((c: { display: string }) => c.display === "IP")).toBe(true);
    const chloe = (await (await as("chloe.delacruz@student.test")).get("/api/me/transcript").expect(200)).body;
    expect(chloe.standing).toBe("DEANS_LIST");
  });

  it("degree progress marks requirements completed / in progress / remaining", async () => {
    const jaya = await as("jaya.katigbak@student.test");
    const p = (await jaya.get("/api/me/progress").expect(200)).body;
    const status = (code: string) => p.requirements.find((r: { code: string }) => r.code === code).status;
    expect(status("CS101")).toBe("COMPLETED");
    expect(status("CS301")).toBe("IN_PROGRESS");
    expect(status("ENGL102")).toBe("REMAINING");
    expect(p.programCode).toBe("BSCS");
    expect(p.unitsEarned).toBe(27);
    expect(p.percent).toBe(Math.round((27 / 144) * 100));
  });

  it("'What can I take next?' lists only courses the student could actually take, program requirements first", async () => {
    const ana = await as(ANA);
    const recs = (await ana.get("/api/me/recommendations").expect(200)).body.recommendations;
    const codes = recs.map((r: { course: { code: string } }) => r.course.code);
    expect(codes).toContain("CS102"); // she passed CS101
    expect(codes).not.toContain("CS201"); // needs CS102
    expect(codes).not.toContain("CS101"); // already passed
    expect(codes).not.toContain("MATH120"); // already enrolled
    expect(recs.every((r: { outcome: string }) => ["ENROLL", "WAITLIST"].includes(r.outcome))).toBe(true);
    expect(recs[0].requiredByProgram).toBe(true);
  });
});

describe("instructor", () => {
  it("lists their classes, shows a roster with waitlist order, and enters grades", async () => {
    const prof = await as("instructor@school.test");
    const courses = (await prof.get("/api/instructor/courses").expect(200)).body.courses;
    expect(courses.every((c: { department: string }) => c.department === "CS")).toBe(true);
    expect(courses.map((c: { code: string }) => c.code)).toContain("CS240");

    const roster = (await prof.get(`/api/instructor/courses/${await cid("CS240")}/roster`).expect(200)).body.entries;
    expect(roster.filter((e: { status: string }) => e.status === "ENROLLED")).toHaveLength(3);
    expect(roster.filter((e: { status: string }) => e.status === "WAITLISTED").map((e: { fullName: string; waitlistPosition: number }) => [e.fullName, e.waitlistPosition])).toEqual([["Faye Gomez", 1], ["Gabe Hernandez", 2]]);

    const enr = await enrId("ben.cruz@student.test", "CS201");
    await prof.put(`/api/instructor/enrollments/${enr}/grade`).send({ grade: 9 }).expect(400); // outside any scale
    expect((await prof.put(`/api/instructor/enrollments/${enr}/grade`).send({ grade: 3.5 }).expect(200)).body).toEqual({ status: "COMPLETED", grade: 3.5 });
    const ben = await as("ben.cruz@student.test");
    expect((await ben.get("/api/me/notifications").expect(200)).body.items.some((n: { type: string }) => n.type === "GRADE")).toBe(true);
    await prof.put(`/api/instructor/enrollments/${enr}/grade`).send({ grade: 2 }).expect(409); // already graded: illegal transition
  });

  it("cannot grade another department's class", async () => {
    const math = await as("jose.villanueva@school.test");
    const enr = await enrId("ben.cruz@student.test", "CS201");
    await math.put(`/api/instructor/enrollments/${enr}/grade`).send({ grade: 3 }).expect(403);
  });
});

describe("admin", () => {
  it("force-enroll needs a reason, skips the rules (not capacity), and is audited", async () => {
    const admin = await as("admin@school.test");
    const [hana] = await q("SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'hana.ignacio@student.test'");
    const course = await cid("GE101");
    await admin.post("/api/admin/enrollments/force").send({ studentId: hana!.id, courseId: course }).expect(400);
    const res = await admin.post("/api/admin/enrollments/force").send({ studentId: hana!.id, courseId: course, reason: "Cleared in person by the cashier" }).expect(201);
    expect(res.body.status).toBe("ENROLLED");
    expect(res.body.warnings[0].code).toBe("HOLD_ACTIVE");
    const audit = (await admin.get("/api/admin/audit?action=FORCE_ENROLL").expect(200)).body;
    expect(audit.total).toBe(1);
    expect(audit.items[0]).toMatchObject({ actorName: "Registrar Admin", studentName: "Hana Ignacio", courseCode: "GE101" });
    expect(audit.items[0].details.reason).toBe("Cleared in person by the cashier");
    const full = await cid("CS240");
    await admin.post("/api/admin/enrollments/force").send({ studentId: hana!.id, courseId: full, reason: "VIP request from the dean" }).expect(409);
  });

  it("raising a course's capacity promotes the waitlist; lowering it below the head-count is refused", async () => {
    const admin = await as("admin@school.test");
    const id = await cid("CS240");
    const body = (await admin.get(`/api/courses/${id}`).expect(200)).body;
    const base = {
      code: body.code, termId: body.termId, title: body.title, description: body.description, units: body.units,
      departmentId: (await q("SELECT department_id FROM courses WHERE id = ?", [id]))[0]!.department_id, instructorId: body.instructorId,
      room: body.room, dropDeadline: null, meetings: body.meetings, prerequisites: body.prerequisites, corequisites: body.corequisites,
    };
    expect((await admin.put(`/api/admin/courses/${id}`).send({ ...base, capacity: 2 }).expect(400)).body.error.message).toMatch(/lower than the 3/);
    expect((await admin.put(`/api/admin/courses/${id}`).send({ ...base, capacity: 5 }).expect(200)).body.promotions).toBe(2);
    const after = (await admin.get(`/api/courses/${id}`).expect(200)).body;
    expect([after.capacity, after.enrolledCount, after.waitlistedCount]).toEqual([5, 5, 0]);
    await admin.put(`/api/admin/courses/${id}`).send({ ...base, code: "CS999", capacity: 5 }).expect(400); // identity is immutable
  });

  it("creates and deletes courses; history blocks deletion", async () => {
    const admin = await as("admin@school.test");
    const meta = (await admin.get("/api/meta").expect(200)).body;
    const term = meta.terms.find((t: { isCurrent: boolean }) => t.isCurrent);
    const payload = { code: "CS499", termId: term.id, title: "Capstone", description: "", units: 3, capacity: 10, departmentId: meta.departments[0].id, instructorId: null, room: null, dropDeadline: null, meetings: [{ day: "MON", startMin: 600, endMin: 660 }], prerequisites: [{ code: "CS301", minGrade: null }], corequisites: [] };
    const created = await admin.post("/api/admin/courses").send(payload).expect(201);
    await admin.post("/api/admin/courses").send(payload).expect(409); // duplicate (code, term)
    await admin.post("/api/admin/courses").send({ ...payload, code: "CS498", meetings: [{ day: "MON", startMin: 700, endMin: 600 }] }).expect(400);
    await admin.delete(`/api/admin/courses/${created.body.id}`).expect(200);
    const refused = await admin.delete(`/api/admin/courses/${await cid("CS101")}`).expect(409);
    expect(refused.body.error.code).toBe("CONFLICT");
  });

  it("manages students: create (they can then sign in), search, duplicates, edit status", async () => {
    const admin = await as("admin@school.test");
    const program = (await admin.get("/api/meta").expect(200)).body.programs[0];
    const input = { fullName: "Pia Santos", email: "pia.santos@student.test", password: "Sup3rSecret!", studentNumber: "2026-0100", programId: program.id, yearLevel: 1, maxUnits: 18 };
    const made = await admin.post("/api/admin/students").send(input).expect(201);
    await admin.post("/api/admin/students").send({ ...input, studentNumber: "2026-0101" }).expect(409); // same email
    await request(app).post("/api/auth/login").send({ email: input.email, password: input.password }).expect(200);
    expect((await admin.get("/api/admin/students?q=Pia").expect(200)).body.items.map((s: { fullName: string }) => s.fullName)).toEqual(["Pia Santos"]);
    await admin.put(`/api/admin/students/${made.body.id}`).send({ fullName: "Pia Santos", programId: program.id, yearLevel: 2, maxUnits: 18, status: "SUSPENDED" }).expect(200);
    const pia = request.agent(app);
    await pia.post("/api/auth/login").send({ email: input.email, password: input.password }).expect(200);
    const res = await pia.post("/api/enrollments").send({ courseId: await cid("CS101") }).expect(422);
    expect(res.body.error.code).toBe("STUDENT_INACTIVE");
    await admin.put("/api/admin/students/99999").send({ fullName: "Nobody", programId: program.id, yearLevel: 1, maxUnits: 18, status: "ACTIVE" }).expect(404);
  });

  it("manages terms: exactly one is current", async () => {
    const admin = await as("admin@school.test");
    const t = (name: string, isCurrent: boolean) => ({ name, isCurrent, registrationOpensAt: "2027-01-01T00:00:00.000Z", registrationClosesAt: "2027-02-01T00:00:00.000Z", dropDeadline: "2027-03-01T00:00:00.000Z", endsAt: "2027-05-01T00:00:00.000Z" });
    const made = await admin.post("/api/admin/terms").send(t("Spring 2027", true)).expect(201);
    const terms = (await admin.get("/api/terms").expect(200)).body.terms;
    expect(terms.filter((x: { isCurrent: boolean }) => x.isCurrent).map((x: { name: string }) => x.name)).toEqual(["Spring 2027"]);
    await admin.put(`/api/admin/terms/${made.body.id}`).send({ ...t("Spring 2027", true), registrationClosesAt: "2026-12-01T00:00:00.000Z" }).expect(400); // closes before it opens
  });

  it("places a hold (notifying the student), announcements fan out to every student's bell", async () => {
    const admin = await as("admin@school.test");
    const lia = await as("lia.mendoza@student.test");
    const [row] = await q("SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'lia.mendoza@student.test'");
    await admin.post("/api/admin/holds").send({ studentId: row!.id, type: "ADVISING", reason: "See your advisor first" }).expect(201);
    const blocked = await lia.post("/api/enrollments").send({ courseId: await cid("CS101") }).expect(422);
    expect(blocked.body.error.message).toContain("See your advisor first");
    const sent = (await admin.post("/api/admin/announcements").send({ title: "Library hours", body: "Open until midnight during finals." }).expect(201)).body;
    expect(sent.notified).toBe(14);
    expect((await lia.get("/api/me/notifications").expect(200)).body.items.some((n: { title: string }) => n.title === "Library hours")).toBe(true);
    expect((await lia.get("/api/announcements").expect(200)).body.announcements[0].title).toBe("Library hours");
  });

  it("analytics summarise fill, waitlists, holds and the unit distribution", async () => {
    const a = (await (await as("admin@school.test")).get("/api/admin/analytics").expect(200)).body;
    expect(a.totals).toMatchObject({ students: 14, courses: 25, waitlisted: 2, activeHolds: 1, pendingOverloads: 1 });
    expect(a.fillByDepartment.map((d: { department: string }) => d.department)).toEqual(["BUS", "CS", "HUM", "MATH", "PHYS"]);
    expect(a.topFull[0]).toMatchObject({ code: "CS240", fillRate: 100, waitlisted: 2 });
    expect(a.waitlists).toEqual([{ code: "CS240", title: "Mobile Application Development", waitlisted: 2 }]);
    expect(a.unitsDistribution.reduce((s: number, b: { students: number }) => s + b.students, 0)).toBe(14);
    expect(a.enrollmentsOverTime.length).toBeGreaterThan(3);
  });

  it("audit log is filterable and paginated", async () => {
    const admin = await as("admin@school.test");
    const all = (await admin.get("/api/admin/audit?pageSize=5").expect(200)).body;
    expect(all.items).toHaveLength(5);
    expect(all.total).toBeGreaterThan(30);
    expect(all.actions).toContain("ENROLL");
    const waits = (await admin.get("/api/admin/audit?action=WAITLIST").expect(200)).body;
    expect(waits.items.every((i: { action: string }) => i.action === "WAITLIST")).toBe(true);
    expect(waits.total).toBe(2);
  });

  it("CSV export escapes values and neutralises spreadsheet formulas", async () => {
    const admin = await as("admin@school.test");
    const program = (await admin.get("/api/meta").expect(200)).body.programs[0];
    const evil = await admin.post("/api/admin/students").send({ fullName: '=HYPERLINK("http://evil.test","click")', email: "evil@student.test", password: "Sup3rSecret!", studentNumber: "2026-6666", programId: program.id, yearLevel: 1, maxUnits: 21 }).expect(201);
    await admin.post("/api/admin/enrollments/force").send({ studentId: evil.body.id, courseId: await cid("MATH101"), reason: "export injection test" }).expect(201);
    const res = await admin.get("/api/admin/export/enrollments.csv").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const lines = res.text.split("\r\n");
    expect(lines[0]).toBe("Student No.,Name,Email,Course,Title,Units,Status,Grade,Enrolled at,Waitlisted at");
    expect(res.text).toContain("CS240");
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(res.text).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});

describe("Rush Simulator", () => {
  it("fires N virtual students at one course concurrently: exactly the free seats succeed, never over-enrolled", async () => {
    const admin = await as("admin@school.test");
    const course = await cid("ENGL210"); // capacity 6, 5 already enrolled
    const res = (await admin.post("/api/admin/simulate/rush").send({ courseId: course, count: 40 }).expect(200)).body;
    expect(res).toMatchObject({ code: "ENGL210", capacity: 6, enrolledBefore: 5, enrolledAfter: 6, attempted: 40, succeeded: 1, waitlisted: 39, rejected: 0, overEnrolled: false });
    expect(res.rows).toHaveLength(40);
    expect(res.rows[0].status).toBe("ENROLLED");
    expect(res.rows.filter((r: { waitlistPosition: number | null }) => r.waitlistPosition !== null).map((r: { waitlistPosition: number }) => r.waitlistPosition).sort((a: number, b: number) => a - b)).toEqual(Array.from({ length: 39 }, (_, i) => i + 1));
    expect(res.durationMs).toBeGreaterThan(0);

    const reset = (await admin.post("/api/admin/simulate/reset").expect(200)).body;
    expect(reset.removedStudents).toBe(40);
    const after = (await admin.get(`/api/courses/${course}`).expect(200)).body;
    expect([after.enrolledCount, after.waitlistedCount]).toEqual([5, 0]); // the scenario is restored exactly
    expect((await q("SELECT COUNT(*) n FROM users WHERE is_simulated = 1"))[0]!.n).toBe(0);
  });

  it("each run starts clean: running twice never stacks virtual students", async () => {
    const admin = await as("admin@school.test");
    const course = await cid("ENGL210");
    const first = (await admin.post("/api/admin/simulate/rush").send({ courseId: course, count: 15 }).expect(200)).body;
    const second = (await admin.post("/api/admin/simulate/rush").send({ courseId: course, count: 15 }).expect(200)).body;
    for (const r of [first, second]) expect(r).toMatchObject({ enrolledBefore: 5, enrolledAfter: 6, succeeded: 1, waitlisted: 14, overEnrolled: false });
    expect((await q("SELECT COUNT(*) n FROM users WHERE is_simulated = 1"))[0]!.n).toBe(15); // not 30
  });

  it("the rules still apply to virtual students: a prerequisite-gated course rejects them with a reason, and nothing is over-filled", async () => {
    const admin = await as("admin@school.test");
    const course = await cid("CS240"); // full, and requires CS101, which virtual students have not passed
    const res = (await admin.post("/api/admin/simulate/rush").send({ courseId: course, count: 10 }).expect(200)).body;
    expect(res).toMatchObject({ succeeded: 0, waitlisted: 0, rejected: 10, overEnrolled: false, enrolledAfter: 3 });
    expect(res.rows[0].reason).toBe("Cannot enroll in CS240: requires CS101 (not completed)");
    expect((await admin.get(`/api/courses/${course}`).expect(200)).body.waitlistedCount).toBe(2); // the real waitlist is untouched
  });

  it("is admin-only and disabled outside DEMO_MODE", async () => {
    await (await as(ANA)).post("/api/admin/simulate/rush").send({ courseId: await cid("ENGL210"), count: 5 }).expect(403);
    const prod = createApp({ config: { ...config, demoMode: false }, loginLimit: 100 });
    const agent = request.agent(prod);
    await agent.post("/api/auth/login").send({ email: "admin@school.test", password: DEMO_PASSWORD }).expect(200);
    const res = await agent.post("/api/admin/simulate/rush").send({ courseId: await cid("ENGL210"), count: 5 }).expect(403);
    expect(res.body.error.message).toMatch(/DEMO_MODE/);
    await agent.post("/api/admin/simulate/reset").expect(403);
  });

  it("validates its input", async () => {
    const admin = await as("admin@school.test");
    await admin.post("/api/admin/simulate/rush").send({ courseId: await cid("ENGL210"), count: 5000 }).expect(400);
    await admin.post("/api/admin/simulate/rush").send({ courseId: 999999, count: 5 }).expect(404);
  });
});
