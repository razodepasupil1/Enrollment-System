import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { CatalogQuery } from "@enroll/shared";
import type { Queryable } from "../db/pool.js";
import type { EnrollmentStatus } from "../domain/types.js";

export interface CourseExtras {
  enrolled: number;
  waitlisted: number;
  instructorName: string | null;
  departmentName: string;
  termName: string;
}

export interface StudentEnrollmentRow {
  id: number;
  courseId: number;
  termId: number;
  status: EnrollmentStatus;
  grade: number | null;
  enrolledAt: Date | null;
  waitlistedAt: Date | null;
  endedAt: Date | null;
}

/** MySQL LIKE treats % and _ as wildcards; escape them so a search for "50%" means "50%". */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// Sort keys are mapped to fixed SQL here; user input never reaches the ORDER BY text.
const SORTS: Record<CatalogQuery["sort"], string> = {
  code: "c.code",
  title: "c.title, c.code",
  units: "c.units DESC, c.code",
  seats: "(c.capacity - COALESCE(en.n, 0)) DESC, c.code",
  fill: "(COALESCE(en.n, 0) / NULLIF(c.capacity, 0)) DESC, c.code",
};

/** Read-only queries that shape data for screens. Business rules live elsewhere. */
export class ReadRepository {
  constructor(private readonly db: Queryable) {}

  async describeCourses(ids: readonly number[]): Promise<Map<number, CourseExtras>> {
    const out = new Map<number, CourseExtras>();
    if (ids.length === 0) return out;
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT c.id, d.name AS department_name, t.name AS term_name, u.full_name AS instructor_name,
              COALESCE(SUM(e.status = 'ENROLLED'), 0) AS enrolled,
              COALESCE(SUM(e.status = 'WAITLISTED'), 0) AS waitlisted
       FROM courses c
       JOIN departments d ON d.id = c.department_id
       JOIN terms t ON t.id = c.term_id
       LEFT JOIN instructors i ON i.id = c.instructor_id
       LEFT JOIN users u ON u.id = i.user_id
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.status IN ('ENROLLED','WAITLISTED')
       WHERE c.id IN (?)
       GROUP BY c.id, d.name, t.name, u.full_name`,
      [ids],
    );
    for (const r of rows) {
      out.set(r.id, {
        enrolled: Number(r.enrolled),
        waitlisted: Number(r.waitlisted),
        instructorName: r.instructor_name ?? null,
        departmentName: r.department_name,
        termName: r.term_name,
      });
    }
    return out;
  }

  async searchCourseIds(f: CatalogQuery & { termId: number }): Promise<{ ids: number[]; total: number }> {
    const where: string[] = ["c.term_id = ?"];
    const params: unknown[] = [f.termId];
    if (f.q) {
      where.push("(c.code LIKE ? OR c.title LIKE ?)");
      params.push(`%${escapeLike(f.q)}%`, `%${escapeLike(f.q)}%`);
    }
    if (f.department) { where.push("d.code = ?"); params.push(f.department); }
    if (f.day) {
      where.push("EXISTS (SELECT 1 FROM course_meetings m WHERE m.course_id = c.id AND m.day = ?)");
      params.push(f.day);
    }
    if (f.minUnits) { where.push("c.units >= ?"); params.push(f.minUnits); }
    if (f.maxUnits) { where.push("c.units <= ?"); params.push(f.maxUnits); }
    if (f.availability === "open") where.push("COALESCE(en.n, 0) < c.capacity");
    if (f.availability === "full") where.push("COALESCE(en.n, 0) >= c.capacity");

    const from = `FROM courses c
      JOIN departments d ON d.id = c.department_id
      LEFT JOIN (SELECT course_id, COUNT(*) AS n FROM enrollments WHERE status = 'ENROLLED' GROUP BY course_id) en
        ON en.course_id = c.id
      WHERE ${where.join(" AND ")}`;

    const [countRows] = await this.db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${from}`, params);
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT c.id ${from} ORDER BY ${SORTS[f.sort]} LIMIT ? OFFSET ?`,
      [...params, f.pageSize, (f.page - 1) * f.pageSize],
    );
    return { ids: rows.map((r) => r.id as number), total: Number(countRows[0]?.n ?? 0) };
  }

  async studentEnrollmentRows(studentId: number, termId?: number): Promise<StudentEnrollmentRow[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT e.id, e.course_id, e.status, e.grade, e.enrolled_at, e.waitlisted_at, e.ended_at, c.term_id
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN terms t ON t.id = c.term_id
       WHERE e.student_id = ? ${termId ? "AND c.term_id = ?" : ""}
       ORDER BY t.registration_opens_at DESC, e.id`,
      termId ? [studentId, termId] : [studentId],
    );
    return rows.map((r) => ({
      id: r.id, courseId: r.course_id, termId: r.term_id, status: r.status as EnrollmentStatus, grade: r.grade,
      enrolledAt: r.enrolled_at, waitlistedAt: r.waitlisted_at, endedAt: r.ended_at,
    }));
  }

  async programFor(studentId: number): Promise<{ id: number; code: string; name: string; requiredUnits: number } | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT p.id, p.code, p.name, p.required_units FROM students s JOIN programs p ON p.id = s.program_id WHERE s.id = ?`,
      [studentId],
    );
    const r = rows[0];
    return r ? { id: r.id, code: r.code, name: r.name, requiredUnits: r.required_units } : null;
  }

  async programRequirements(programId: number): Promise<Array<{ code: string; category: string }>> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT course_code, category FROM program_requirements WHERE program_id = ? ORDER BY id", [programId]);
    return rows.map((r) => ({ code: r.course_code, category: r.category }));
  }

  /** Latest known title per catalog code (offerings differ by term, the code is the identity). */
  async titlesForCodes(codes: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (codes.length === 0) return out;
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT code, title FROM courses WHERE code IN (?) ORDER BY id DESC", [codes]);
    for (const r of rows) if (!out.has(r.code)) out.set(r.code, r.title);
    return out;
  }

  // --- notifications -----------------------------------------------------------
  async notifications(userId: number, limit = 30) {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT id, type, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      [userId, limit]);
    const [cnt] = await this.db.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0", [userId]);
    return {
      items: rows.map((r) => ({ id: r.id as number, type: r.type as string, title: r.title as string, body: r.body as string, isRead: r.is_read === 1, createdAt: r.created_at as Date })),
      unreadCount: Number(cnt[0]?.n ?? 0),
    };
  }

  /** Scoped by user_id so one user can never mark another's notification. */
  async markNotificationRead(id: number, userId: number): Promise<boolean> {
    const [res] = await this.db.query<ResultSetHeader>(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", [id, userId]);
    return res.affectedRows > 0;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await this.db.query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [userId]);
  }

  // --- announcements -------------------------------------------------------------
  async announcements(limit = 10) {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT a.id, a.title, a.body, a.created_at, u.full_name AS author_name
       FROM announcements a LEFT JOIN users u ON u.id = a.author_id ORDER BY a.created_at DESC, a.id DESC LIMIT ?`, [limit]);
    return rows.map((r) => ({ id: r.id as number, title: r.title as string, body: r.body as string, authorName: (r.author_name ?? null) as string | null, createdAt: r.created_at as Date }));
  }

  // --- overload requests (student side) --------------------------------------------
  async pendingOverloadCount(studentId: number): Promise<number> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM overload_requests WHERE student_id = ? AND status = 'PENDING'", [studentId]);
    return Number(rows[0]?.n ?? 0);
  }

  async createOverloadRequest(r: { studentId: number; termId: number; extraUnits: number; reason: string; now: Date }): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      "INSERT INTO overload_requests (student_id, term_id, extra_units, reason, created_at) VALUES (?, ?, ?, ?, ?)",
      [r.studentId, r.termId, r.extraUnits, r.reason, r.now]);
    return res.insertId;
  }

  // --- rosters / instructor ---------------------------------------------------------
  async roster(courseId: number) {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT e.id, e.status, e.grade, e.waitlisted_at, s.id AS student_id, s.student_number, u.full_name, u.email
       FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id
       WHERE e.course_id = ? AND e.status IN ('ENROLLED','WAITLISTED','COMPLETED','FAILED')
       ORDER BY FIELD(e.status, 'ENROLLED','COMPLETED','FAILED','WAITLISTED'), e.waitlisted_at, u.full_name`, [courseId]);
    return rows.map((r) => ({
      enrollmentId: r.id as number, studentId: r.student_id as number, studentNumber: r.student_number as string,
      fullName: r.full_name as string, email: r.email as string, status: r.status as EnrollmentStatus, grade: r.grade as number | null,
    }));
  }

  async instructorCourseIds(instructorId: number, termId: number): Promise<number[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT id FROM courses WHERE instructor_id = ? AND term_id = ? ORDER BY code", [instructorId, termId]);
    return rows.map((r) => r.id as number);
  }

  async courseInstructorId(courseId: number): Promise<number | null | undefined> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT instructor_id FROM courses WHERE id = ?", [courseId]);
    return rows[0] ? (rows[0].instructor_id as number | null) : undefined;
  }
}
