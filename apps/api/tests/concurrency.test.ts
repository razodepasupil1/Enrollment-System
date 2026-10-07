import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { DomainError } from "../src/errors/index.js";
import { EnrollmentService } from "../src/services/index.js";
import type { EnrollResult } from "../src/services/index.js";
import { World, type TestStudent } from "./helpers/world.js";

// A pool bigger than the default so many transactions are genuinely in flight at once.
const pool = createPool({ ...loadConfig(), poolLimit: 10 });
let w: World;
let svc: EnrollmentService;

beforeEach(async () => {
  w = await World.create(pool);
  svc = new EnrollmentService(pool);
});
afterAll(() => pool.end());

const students = async (n: number): Promise<TestStudent[]> => {
  const out: TestStudent[] = [];
  for (let i = 0; i < n; i++) out.push(await w.addStudent());
  return out;
};

/** Runs everything concurrently and insists any failure is an EXPECTED business error, never a deadlock/crash. */
async function settle<T>(jobs: Array<() => Promise<T>>) {
  const outcomes = await Promise.allSettled(jobs.map((j) => j()));
  const ok: T[] = [];
  const rejected: DomainError[] = [];
  for (const o of outcomes) {
    if (o.status === "fulfilled") ok.push(o.value);
    else {
      expect(o.reason, `unexpected non-domain failure: ${String(o.reason)}`).toBeInstanceOf(DomainError);
      rejected.push(o.reason as DomainError);
    }
  }
  return { ok, rejected };
}

describe("race: many students, one course", () => {
  it("capacity + 10 parallel enrolls -> exactly `capacity` ENROLLED, the other 10 WAITLISTED", async () => {
    const capacity = 15;
    const course = await w.addCourse({ code: "RUSH101", capacity });
    const crowd = await students(capacity + 10);

    const { ok, rejected } = await settle(
      crowd.map((s) => () => svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor })),
    );

    expect(rejected).toHaveLength(0);
    expect(ok.filter((r) => r.status === "ENROLLED")).toHaveLength(capacity);
    expect(ok.filter((r) => r.status === "WAITLISTED")).toHaveLength(10);

    // The database agrees with what the callers were told.
    expect(await w.enrolledCount(course)).toBe(capacity);
    expect(await w.waitlistedCount(course)).toBe(10);

    // Waitlist positions are a clean 1..10 with no duplicates or gaps (derived, never stored).
    const positions = ok.filter((r) => r.status === "WAITLISTED").map((r) => r.waitlistPosition).sort((a, b) => a! - b!);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Audit log is consistent with the outcome: one row per enrollment, none lost, none extra.
    expect(await w.count("SELECT COUNT(*) n FROM audit_log WHERE action = 'ENROLL'")).toBe(capacity);
    expect(await w.count("SELECT COUNT(*) n FROM audit_log WHERE action = 'WAITLIST'")).toBe(10);
    expect(await w.count("SELECT COUNT(*) n FROM enrollments WHERE course_id = ?", [course])).toBe(capacity + 10);
  });

  it("one seat left and 12 students: exactly one wins", async () => {
    const course = await w.addCourse({ code: "LAST1", capacity: 5 });
    const early = await students(4);
    for (const s of early) await svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor });
    const crowd = await students(12);

    const { ok } = await settle(crowd.map((s) => () => svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor })));
    expect(ok.filter((r) => r.status === "ENROLLED")).toHaveLength(1);
    expect(ok.filter((r) => r.status === "WAITLISTED")).toHaveLength(11);
    expect(await w.enrolledCount(course)).toBe(5);
  });
});

describe("race: one student, one course (double click)", () => {
  it("5 simultaneous submits create exactly one active enrollment", async () => {
    const [s] = await students(1);
    const course = await w.addCourse({ code: "CS101", capacity: 30 });

    const { ok, rejected } = await settle(
      Array.from({ length: 5 }, () => () => svc.enroll({ studentId: s!.studentId, courseId: course, actor: s!.actor })),
    );

    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(new Set(rejected.map((e) => e.code))).toEqual(new Set(["ALREADY_ENROLLED"]));
    expect(await w.count("SELECT COUNT(*) n FROM enrollments WHERE student_id = ?", [s!.studentId])).toBe(1);
  });
});

describe("race: one student, many courses (unit limit)", () => {
  it("the limit holds even when the enrolls arrive at the same instant", async () => {
    const [s] = await students(1);
    const limited = await w.addStudent({ maxUnits: 6 });
    const courses = await Promise.all(["A", "B", "C", "D", "E"].map((c) => w.addCourse({ code: `U${c}`, units: 3 })));

    const { ok, rejected } = await settle(
      courses.map((id) => () => svc.enroll({ studentId: limited.studentId, courseId: id, actor: limited.actor })),
    );

    expect(ok).toHaveLength(2); // 2 x 3 units = 6 = the limit
    expect(rejected.map((e) => e.code)).toEqual(Array(3).fill("UNIT_LIMIT_EXCEEDED"));
    expect(await w.count("SELECT COUNT(*) n FROM enrollments WHERE student_id = ? AND status = 'ENROLLED'", [limited.studentId])).toBe(2);
    expect(s).toBeDefined();
  });
});

describe("race: drops promote the waitlist", () => {
  it("3 simultaneous drops promote exactly the 3 earliest waitlisted students", async () => {
    const course = await w.addCourse({ code: "CS240", capacity: 3 });
    const seated = await students(3);
    const seatedResults: EnrollResult[] = [];
    for (const s of seated) seatedResults.push(await svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor }));
    const queue = await students(5);
    const queueResults: EnrollResult[] = [];
    for (const s of queue) queueResults.push(await svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor })); // sequential => fixed order

    const { ok } = await settle(
      seated.map((s, i) => () => svc.drop({ enrollmentId: seatedResults[i]!.enrollmentId, actor: s.actor })),
    );

    const promoted = ok.flatMap((r) => r.promotions).filter((p) => p.outcome === "PROMOTED");
    expect(promoted).toHaveLength(3);
    // The first three in line got in, nobody was promoted twice, nobody jumped the queue.
    expect(new Set(promoted.map((p) => p.enrollmentId))).toEqual(new Set(queueResults.slice(0, 3).map((r) => r.enrollmentId)));
    expect(await w.enrolledCount(course)).toBe(3);
    expect(await w.waitlistedCount(course)).toBe(2);
    expect(await w.count("SELECT COUNT(*) n FROM audit_log WHERE action = 'PROMOTE'")).toBe(3);
  });

  it("drops racing new enrollments never over-fill a seat or strand a waitlisted student", async () => {
    const course = await w.addCourse({ code: "MIX101", capacity: 3 });
    const seated = await students(3);
    const seatedResults: EnrollResult[] = [];
    for (const s of seated) seatedResults.push(await svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor }));
    const newcomers = await students(6);

    // 3 drops and 6 fresh enrolls, all at once.
    const jobs: Array<() => Promise<unknown>> = [
      ...seated.map((s, i) => () => svc.drop({ enrollmentId: seatedResults[i]!.enrollmentId, actor: s.actor })),
      ...newcomers.map((s) => () => svc.enroll({ studentId: s.studentId, courseId: course, actor: s.actor })),
    ];
    const { rejected } = await settle(jobs);
    expect(rejected).toHaveLength(0);

    // 6 newcomers for 3 seats: whichever order things ran in, the end state is the same.
    expect(await w.enrolledCount(course)).toBe(3);
    expect(await w.waitlistedCount(course)).toBe(3);
    // And the cardinal invariant: never a free seat while someone is still waiting.
    const free = 3 - (await w.enrolledCount(course));
    expect(free === 0 || (await w.waitlistedCount(course)) === 0).toBe(true);
  });
});
