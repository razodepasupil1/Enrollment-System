import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Pool } from "../../src/db/pool.js";
import { clearAllData } from "../../src/db/seed.js";
import type { Day } from "../../src/domain/types.js";
import type { Actor } from "../../src/services/types.js";
import { assertTestDatabase } from "./db.js";

const DAY = 86_400_000;

export interface TestStudent {
  studentId: number;
  userId: number;
  actor: Actor;
}

export interface CourseOpts {
  code: string;
  capacity?: number;
  units?: number;
  meetings?: ReadonlyArray<readonly [Day[], number, number]>;
  prereq?: ReadonlyArray<readonly [string, number?]>;
  coreq?: readonly string[];
  dropDeadline?: Date | null;
  instructorId?: number | null;
}

/**
 * A small, explicit test universe. Unlike the demo seed, every test builds only what it needs,
 * so a failing test points at exactly one scenario. Courses default to NO meetings (TBA),
 * which means they can never conflict by accident.
 */
export class World {
  termId = 0;
  pastTermId = 0;
  deptId = 0;
  programId = 0;
  instructorId = 0;
  instructorUserId = 0;
  admin!: Actor;
  instructor!: Actor;
  private seq = 0;
  private pastCourses = new Map<string, number>();

  private constructor(readonly pool: Pool, readonly now: Date) {}

  static async create(pool: Pool): Promise<World> {
    assertTestDatabase();
    await clearAllData(pool);
    const w = new World(pool, new Date());
    await w.init();
    return w;
  }

  private async run(sql: string, params: unknown[] = []): Promise<number> {
    const [res] = await this.pool.query<ResultSetHeader>(sql, params);
    return res.insertId;
  }

  private async init(): Promise<void> {
    const { now } = this;
    this.deptId = await this.run("INSERT INTO departments (code, name) VALUES ('CS', 'Computer Science')");
    this.programId = await this.run("INSERT INTO programs (department_id, code, name, required_units) VALUES (?, 'BSCS', 'BSCS', 120)", [this.deptId]);
    this.pastTermId = await this.run(
      `INSERT INTO terms (name, is_current, registration_opens_at, registration_closes_at, drop_deadline, ends_at)
       VALUES ('Past Term', 0, ?, ?, ?, ?)`,
      [new Date(now.getTime() - 300 * DAY), new Date(now.getTime() - 270 * DAY), new Date(now.getTime() - 250 * DAY), new Date(now.getTime() - 120 * DAY)],
    );
    // Current term: open now, drop deadline in two weeks, ends in three months.
    this.termId = await this.run(
      `INSERT INTO terms (name, is_current, registration_opens_at, registration_closes_at, drop_deadline, ends_at)
       VALUES ('Test Term', 1, ?, ?, ?, ?)`,
      [new Date(now.getTime() - 10 * DAY), new Date(now.getTime() + 30 * DAY), new Date(now.getTime() + 14 * DAY), new Date(now.getTime() + 90 * DAY)],
    );
    const adminUser = await this.addUser("admin@t.test", "Admin", "admin");
    this.admin = { userId: adminUser, role: "admin" };
    this.instructorUserId = await this.addUser("prof@t.test", "Prof Test", "instructor");
    this.instructorId = await this.run("INSERT INTO instructors (user_id, department_id) VALUES (?, ?)", [this.instructorUserId, this.deptId]);
    this.instructor = { userId: this.instructorUserId, role: "instructor", instructorId: this.instructorId };
  }

  private addUser(email: string, name: string, role: "student" | "instructor" | "admin"): Promise<number> {
    return this.run("INSERT INTO users (email, password_hash, full_name, role, created_at) VALUES (?, '$2b$10$x', ?, ?, ?)", [email, name, role, this.now]);
  }

  async addStudent(o: { maxUnits?: number; year?: number; status?: string; grades?: Record<string, number> } = {}): Promise<TestStudent> {
    const n = ++this.seq;
    const userId = await this.addUser(`s${n}@t.test`, `Student ${n}`, "student");
    const studentId = await this.run(
      "INSERT INTO students (user_id, student_number, program_id, year_level, max_units, status) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, `2026-${String(n).padStart(4, "0")}`, this.programId, o.year ?? 2, o.maxUnits ?? 21, o.status ?? "ACTIVE"],
    );
    for (const [code, grade] of Object.entries(o.grades ?? {})) await this.addPastGrade(studentId, code, grade);
    return { studentId, userId, actor: { userId, role: "student", studentId } };
  }

  /** A graded enrollment in the past term (creates that term's offering of `code` on first use). */
  async addPastGrade(studentId: number, code: string, grade: number, units = 3): Promise<void> {
    let courseId = this.pastCourses.get(code);
    if (!courseId) {
      courseId = await this.run(
        "INSERT INTO courses (code, term_id, title, units, capacity, department_id) VALUES (?, ?, ?, ?, 99, ?)",
        [code, this.pastTermId, `${code} (past)`, units, this.deptId],
      );
      this.pastCourses.set(code, courseId);
    }
    await this.run(
      "INSERT INTO enrollments (student_id, course_id, status, grade, enrolled_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)",
      [studentId, courseId, grade >= 1 ? "COMPLETED" : "FAILED", grade, this.now, this.now],
    );
  }

  async addCourse(o: CourseOpts): Promise<number> {
    const id = await this.run(
      `INSERT INTO courses (code, term_id, title, units, capacity, department_id, instructor_id, drop_deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.code, this.termId, `${o.code} title`, o.units ?? 3, o.capacity ?? 30, this.deptId,
       o.instructorId === undefined ? this.instructorId : o.instructorId, o.dropDeadline ?? null],
    );
    for (const [days, start, end] of o.meetings ?? []) {
      for (const day of days) await this.run("INSERT INTO course_meetings (course_id, day, start_min, end_min) VALUES (?, ?, ?, ?)", [id, day, start, end]);
    }
    for (const [pre, min] of o.prereq ?? []) await this.run("INSERT INTO prerequisites (course_code, prereq_code, min_grade) VALUES (?, ?, ?)", [o.code, pre, min ?? null]);
    for (const co of o.coreq ?? []) await this.run("INSERT INTO corequisites (course_code, coreq_code) VALUES (?, ?)", [o.code, co]);
    return id;
  }

  addHold(studentId: number, reason = "Unpaid balance"): Promise<number> {
    return this.run("INSERT INTO holds (student_id, type, reason, placed_at) VALUES (?, 'FINANCIAL', ?, ?)", [studentId, reason, this.now]);
  }

  async clearHolds(studentId: number): Promise<void> {
    await this.run("UPDATE holds SET cleared_at = ? WHERE student_id = ?", [this.now, studentId]);
  }

  approveOverload(studentId: number, units: number): Promise<number> {
    return this.run(
      "INSERT INTO overload_requests (student_id, term_id, extra_units, reason, status, created_at) VALUES (?, ?, ?, 'test', 'APPROVED', ?)",
      [studentId, this.termId, units, this.now],
    );
  }

  async setCapacity(courseId: number, capacity: number): Promise<void> {
    await this.run("UPDATE courses SET capacity = ? WHERE id = ?", [capacity, courseId]);
  }

  async rows<T extends RowDataPacket = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query<T[]>(sql, params);
    return rows;
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await this.rows(sql, params))[0]?.n ?? 0);
  }

  enrolledCount(courseId: number): Promise<number> {
    return this.count("SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND status = 'ENROLLED'", [courseId]);
  }

  waitlistedCount(courseId: number): Promise<number> {
    return this.count("SELECT COUNT(*) n FROM enrollments WHERE course_id = ? AND status = 'WAITLISTED'", [courseId]);
  }

  async statusOf(enrollmentId: number): Promise<string> {
    return String((await this.rows("SELECT status FROM enrollments WHERE id = ?", [enrollmentId]))[0]?.status);
  }
}
