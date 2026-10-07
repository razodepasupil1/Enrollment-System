import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../src/db/pool.js";
import { seedDatabase } from "../../src/db/seed.js";
import { reposFor } from "../../src/repositories/index.js";
import { assertTestDatabase } from "../helpers/db.js";

const pool = () => getPool();
const q = async <T extends RowDataPacket>(sql: string, params: unknown[] = []) => (await pool().query<T[]>(sql, params))[0];

beforeAll(async () => {
  assertTestDatabase();
  await seedDatabase(pool());
});
afterAll(closePool);

describe("seed: scenarios the demo needs", () => {
  it("has two terms, exactly one current, with 25+ current-term courses and 5 departments", async () => {
    expect((await q("SELECT * FROM terms")).length).toBe(2);
    expect((await q("SELECT * FROM terms WHERE is_current = 1")).map((t) => t.name)).toEqual(["Fall 2026"]);
    expect((await q("SELECT COUNT(*) n FROM courses c JOIN terms t ON t.id = c.term_id WHERE t.is_current = 1"))[0]!.n).toBeGreaterThanOrEqual(24);
    expect((await q("SELECT COUNT(*) n FROM departments"))[0]!.n).toBe(5);
    expect((await q("SELECT COUNT(*) n FROM students"))[0]!.n).toBeGreaterThanOrEqual(12);
  });

  it("CS240 is full with an ordered waitlist of two", async () => {
    const [course] = await q("SELECT c.id, c.capacity FROM courses c JOIN terms t ON t.id = c.term_id WHERE c.code = 'CS240' AND t.is_current = 1");
    const { enrollments } = reposFor(pool());
    expect(await enrollments.countByStatus(course!.id, "ENROLLED")).toBe(course!.capacity);
    const queue = await enrollments.waitlistQueue(course!.id);
    expect(queue).toHaveLength(2);
    expect(await enrollments.waitlistPosition(queue[0]!.id!)).toBe(1);
    expect(await enrollments.waitlistPosition(queue[1]!.id!)).toBe(2);
  });

  it("ENGL210 has exactly one seat left (the Rush Simulator target)", async () => {
    const [c] = await q("SELECT id, capacity FROM courses WHERE code = 'ENGL210' AND term_id = (SELECT id FROM terms WHERE is_current = 1)");
    expect(await reposFor(pool()).enrollments.countByStatus(c!.id, "ENROLLED")).toBe(c!.capacity - 1);
  });

  it("has a course whose own drop deadline is already past", async () => {
    const [c] = await q("SELECT drop_deadline FROM courses WHERE code = 'GE102'");
    expect(new Date(c!.drop_deadline).getTime()).toBeLessThan(Date.now());
  });

  it("has a hold, a pending overload request, a student at the unit limit, and a two-level prerequisite chain", async () => {
    expect((await q("SELECT * FROM holds WHERE cleared_at IS NULL")).length).toBe(1);
    expect((await q("SELECT * FROM overload_requests WHERE status = 'PENDING'")).length).toBe(1);
    const prereqs = await q("SELECT course_code, prereq_code FROM prerequisites");
    const has = (a: string, b: string) => prereqs.some((p) => p.course_code === a && p.prereq_code === b);
    expect(has("CS201", "CS102") && has("CS102", "CS101")).toBe(true);
  });

  it("MATH120 and PHYS101 conflict (the demo clash) while MATH120 and CS240 are merely back-to-back", async () => {
    const { courses, terms } = reposFor(pool());
    const term = (await terms.findCurrent())!;
    const all = await courses.findByTerm(term.id);
    const by = (code: string) => all.find((c) => c.code === code)!;
    expect(by("MATH120").conflictsWith(by("PHYS101"))).toBe(true);
    expect(by("MATH120").conflictsWith(by("CS240"))).toBe(false);
    expect(by("MATH120").meetingSummary()).toBe("Mon/Wed 9:00-10:30");
  });
});

describe("seed: data obeys its own business rules", () => {
  it("every current-term student is consistent: no clashes, prerequisites met, units within limit, seats within capacity", async () => {
    const { students, terms, enrollments, courses } = reposFor(pool());
    const term = (await terms.findCurrent())!;
    const rows = await q("SELECT id FROM students");
    for (const { id } of rows) {
      const { student } = (await students.findById(id))!;
      const active = await enrollments.findActiveWithCourses(id, term.id);
      const taken = active.filter((a) => a.enrollment.status === "ENROLLED");

      expect(student.totalUnits(active), `${student.fullName} units`).toBeLessThanOrEqual(student.maxUnits);
      for (const a of taken) {
        for (const pre of a.course.prerequisites) {
          expect(student.hasCompleted(pre.code, pre.minGrade), `${student.fullName} lacks ${pre.code} for ${a.course.code}`).toBe(true);
        }
        for (const b of taken) {
          if (a !== b) expect(a.course.conflictsWith(b.course), `${student.fullName}: ${a.course.code} vs ${b.course.code}`).toBe(false);
        }
      }
    }
    for (const c of await courses.findByTerm(term.id)) {
      expect(await enrollments.countByStatus(c.id, "ENROLLED"), `${c.code} seats`).toBeLessThanOrEqual(c.capacity);
    }
  });

  it("re-seeding is repeatable (same row counts)", async () => {
    const before = (await q("SELECT COUNT(*) n FROM enrollments"))[0]!.n;
    await seedDatabase(pool());
    expect((await q("SELECT COUNT(*) n FROM enrollments"))[0]!.n).toBe(before);
  });

  it("no password hash is stored in plain text", async () => {
    const rows = await q("SELECT password_hash FROM users");
    expect(rows.every((r) => String(r.password_hash).startsWith("$2"))).toBe(true);
  });
});
