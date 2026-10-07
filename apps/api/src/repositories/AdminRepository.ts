import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { CourseInput, TermInput } from "@enroll/shared";
import type { Queryable } from "../db/pool.js";

const jsonOf = (v: unknown): Record<string, unknown> | null =>
  v === null || v === undefined ? null : typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : (v as Record<string, unknown>);

/** SQL for the admin console. Authorization and audit live in AdminService; this file only talks to MySQL. */
export class AdminRepository {
  constructor(private readonly db: Queryable) {}

  private async run(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
    const [res] = await this.db.query<ResultSetHeader>(sql, params);
    return res;
  }
  private async rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(sql, params);
    return rows;
  }

  // --- meta -----------------------------------------------------------------------
  async departments() {
    return (await this.rows("SELECT id, code, name FROM departments ORDER BY code")).map((r) => ({ id: r.id as number, code: r.code as string, name: r.name as string }));
  }
  async programs() {
    return (await this.rows("SELECT id, code, name, department_id FROM programs ORDER BY code")).map((r) => ({ id: r.id as number, code: r.code as string, name: r.name as string, departmentId: r.department_id as number }));
  }

  // --- courses -----------------------------------------------------------------------
  async courseCode(id: number): Promise<{ code: string; termId: number; capacity: number } | null> {
    const r = (await this.rows("SELECT code, term_id, capacity FROM courses WHERE id = ?", [id]))[0];
    return r ? { code: r.code, termId: r.term_id, capacity: r.capacity } : null;
  }

  async insertCourse(c: CourseInput): Promise<number> {
    const res = await this.run(
      `INSERT INTO courses (code, term_id, title, description, units, capacity, department_id, instructor_id, room, drop_deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.code.toUpperCase(), c.termId, c.title, c.description, c.units, c.capacity, c.departmentId, c.instructorId, c.room, c.dropDeadline ? new Date(c.dropDeadline) : null]);
    await this.replaceCourseDetails(res.insertId, c.code.toUpperCase(), c);
    return res.insertId;
  }

  async updateCourse(id: number, c: CourseInput): Promise<void> {
    await this.run(
      `UPDATE courses SET title = ?, description = ?, units = ?, capacity = ?, department_id = ?, instructor_id = ?, room = ?, drop_deadline = ? WHERE id = ?`,
      [c.title, c.description, c.units, c.capacity, c.departmentId, c.instructorId, c.room, c.dropDeadline ? new Date(c.dropDeadline) : null, id]);
    await this.replaceCourseDetails(id, c.code.toUpperCase(), c);
  }

  /** Meetings belong to the offering; prerequisites/corequisites belong to the catalog CODE (all terms). */
  private async replaceCourseDetails(courseId: number, code: string, c: CourseInput): Promise<void> {
    await this.run("DELETE FROM course_meetings WHERE course_id = ?", [courseId]);
    for (const m of c.meetings) await this.run("INSERT INTO course_meetings (course_id, day, start_min, end_min) VALUES (?, ?, ?, ?)", [courseId, m.day, m.startMin, m.endMin]);
    await this.run("DELETE FROM prerequisites WHERE course_code = ?", [code]);
    for (const p of c.prerequisites) await this.run("INSERT INTO prerequisites (course_code, prereq_code, min_grade) VALUES (?, ?, ?)", [code, p.code.toUpperCase(), p.minGrade]);
    await this.run("DELETE FROM corequisites WHERE course_code = ?", [code]);
    for (const co of c.corequisites) await this.run("INSERT INTO corequisites (course_code, coreq_code) VALUES (?, ?)", [code, co.toUpperCase()]);
  }

  async courseEnrollmentRows(courseId: number): Promise<number> {
    return Number((await this.rows("SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?", [courseId]))[0]?.n ?? 0);
  }
  async deleteCourse(id: number): Promise<void> {
    await this.run("DELETE FROM courses WHERE id = ?", [id]);
  }

  // --- students ----------------------------------------------------------------------
  async listStudents(q: string | undefined, page: number, pageSize: number) {
    const where = ["u.is_simulated = 0"];
    const params: unknown[] = [];
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(u.full_name LIKE ? OR s.student_number LIKE ? OR u.email LIKE ?)");
      params.push(like, like, like);
    }
    const from = `FROM students s JOIN users u ON u.id = s.user_id JOIN programs p ON p.id = s.program_id WHERE ${where.join(" AND ")}`;
    const total = Number((await this.rows(`SELECT COUNT(*) AS n ${from}`, params))[0]?.n ?? 0);
    const rows = await this.rows(
      `SELECT s.id, s.user_id, s.student_number, u.full_name, u.email, s.program_id, p.code AS program_code, s.year_level, s.max_units, s.status,
              (SELECT COUNT(*) FROM holds h WHERE h.student_id = s.id AND h.cleared_at IS NULL) AS active_holds,
              COALESCE((SELECT SUM(c.units) FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN terms t ON t.id = c.term_id
                        WHERE e.student_id = s.id AND e.status = 'ENROLLED' AND t.is_current = 1), 0) AS enrolled_units
       ${from} ORDER BY s.student_number LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id as number, userId: r.user_id as number, studentNumber: r.student_number as string, fullName: r.full_name as string, email: r.email as string,
        programId: r.program_id as number, programCode: r.program_code as string, yearLevel: r.year_level as number, maxUnits: r.max_units as number,
        status: r.status as "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED", activeHolds: Number(r.active_holds), enrolledUnits: Number(r.enrolled_units),
      })),
    };
  }

  async insertUser(email: string, hash: string, fullName: string, role: "student" | "instructor" | "admin", now: Date, simulated = false): Promise<number> {
    return (await this.run("INSERT INTO users (email, password_hash, full_name, role, is_simulated, created_at) VALUES (?, ?, ?, ?, ?, ?)", [email, hash, fullName, role, simulated ? 1 : 0, now])).insertId;
  }
  async insertStudent(userId: number, number: string, programId: number, year: number, maxUnits: number): Promise<number> {
    return (await this.run("INSERT INTO students (user_id, student_number, program_id, year_level, max_units) VALUES (?, ?, ?, ?, ?)", [userId, number, programId, year, maxUnits])).insertId;
  }
  async updateStudent(id: number, v: { fullName: string; programId: number; yearLevel: number; maxUnits: number; status: string }): Promise<boolean> {
    const res = await this.run("UPDATE students s JOIN users u ON u.id = s.user_id SET u.full_name = ?, s.program_id = ?, s.year_level = ?, s.max_units = ?, s.status = ? WHERE s.id = ?",
      [v.fullName, v.programId, v.yearLevel, v.maxUnits, v.status, id]);
    return res.affectedRows > 0;
  }

  // --- instructors ----------------------------------------------------------------------
  async listInstructors() {
    return (await this.rows(
      `SELECT i.id, i.user_id, u.full_name, u.email, i.department_id, d.name AS department_name, i.title
       FROM instructors i JOIN users u ON u.id = i.user_id JOIN departments d ON d.id = i.department_id ORDER BY u.full_name`))
      .map((r) => ({ id: r.id as number, userId: r.user_id as number, fullName: r.full_name as string, email: r.email as string, departmentId: r.department_id as number, departmentName: r.department_name as string, title: r.title as string }));
  }
  async insertInstructor(userId: number, departmentId: number, title: string): Promise<number> {
    return (await this.run("INSERT INTO instructors (user_id, department_id, title) VALUES (?, ?, ?)", [userId, departmentId, title])).insertId;
  }
  async updateInstructor(id: number, v: { fullName: string; departmentId: number; title: string }): Promise<boolean> {
    const res = await this.run("UPDATE instructors i JOIN users u ON u.id = i.user_id SET u.full_name = ?, i.department_id = ?, i.title = ? WHERE i.id = ?", [v.fullName, v.departmentId, v.title, id]);
    return res.affectedRows > 0;
  }

  // --- terms --------------------------------------------------------------------------------
  async insertTerm(t: TermInput): Promise<number> {
    return (await this.run("INSERT INTO terms (name, is_current, registration_opens_at, registration_closes_at, drop_deadline, ends_at) VALUES (?, 0, ?, ?, ?, ?)",
      [t.name, new Date(t.registrationOpensAt), new Date(t.registrationClosesAt), new Date(t.dropDeadline), new Date(t.endsAt)])).insertId;
  }
  async updateTerm(id: number, t: TermInput): Promise<boolean> {
    const res = await this.run("UPDATE terms SET name = ?, registration_opens_at = ?, registration_closes_at = ?, drop_deadline = ?, ends_at = ? WHERE id = ?",
      [t.name, new Date(t.registrationOpensAt), new Date(t.registrationClosesAt), new Date(t.dropDeadline), new Date(t.endsAt), id]);
    return res.affectedRows > 0;
  }
  /** At most one current term (also enforced by a unique generated column), so clear first, then set. */
  async setCurrentTerm(id: number): Promise<void> {
    await this.run("UPDATE terms SET is_current = 0 WHERE is_current = 1 AND id <> ?", [id]);
    await this.run("UPDATE terms SET is_current = 1 WHERE id = ?", [id]);
  }

  // --- holds ----------------------------------------------------------------------------------
  async listHolds(activeOnly: boolean) {
    return (await this.rows(
      `SELECT h.id, h.student_id, h.type, h.reason, h.placed_at, h.cleared_at, su.full_name AS student_name, s.student_number, pu.full_name AS placed_by_name
       FROM holds h JOIN students s ON s.id = h.student_id JOIN users su ON su.id = s.user_id LEFT JOIN users pu ON pu.id = h.placed_by
       ${activeOnly ? "WHERE h.cleared_at IS NULL" : ""} ORDER BY (h.cleared_at IS NOT NULL), h.placed_at DESC, h.id DESC LIMIT 200`))
      .map((r) => ({
        id: r.id as number, studentId: r.student_id as number, studentName: r.student_name as string, studentNumber: r.student_number as string,
        type: r.type as "FINANCIAL" | "ADVISING" | "ACADEMIC", reason: r.reason as string, placedAt: r.placed_at as Date, clearedAt: (r.cleared_at ?? null) as Date | null, placedByName: (r.placed_by_name ?? null) as string | null,
      }));
  }
  async studentUserId(studentId: number): Promise<number | null> {
    return (await this.rows("SELECT user_id FROM students WHERE id = ?", [studentId]))[0]?.user_id ?? null;
  }
  async holdStudentId(holdId: number): Promise<number | null> {
    return (await this.rows("SELECT student_id FROM holds WHERE id = ? AND cleared_at IS NULL", [holdId]))[0]?.student_id ?? null;
  }

  // --- overload requests -------------------------------------------------------------------------
  async listOverloads(status?: string, studentId?: number) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (status) { conds.push("o.status = ?"); params.push(status); }
    if (studentId) { conds.push("o.student_id = ?"); params.push(studentId); }
    return (await this.rows(
      `SELECT o.id, o.student_id, o.term_id, o.extra_units, o.reason, o.status, o.created_at, o.decided_at, o.decision_note,
              su.full_name AS student_name, s.student_number, s.max_units, t.name AS term_name,
              COALESCE((SELECT SUM(c.units) FROM enrollments e JOIN courses c ON c.id = e.course_id
                        WHERE e.student_id = o.student_id AND c.term_id = o.term_id AND e.status = 'ENROLLED'), 0) AS current_units
       FROM overload_requests o JOIN students s ON s.id = o.student_id JOIN users su ON su.id = s.user_id JOIN terms t ON t.id = o.term_id
       ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""} ORDER BY (o.status <> 'PENDING'), o.created_at DESC, o.id DESC LIMIT 200`, params))
      .map((r) => ({
        id: r.id as number, studentId: r.student_id as number, studentName: r.student_name as string, studentNumber: r.student_number as string,
        termId: r.term_id as number, termName: r.term_name as string, extraUnits: r.extra_units as number, reason: r.reason as string,
        status: r.status as "PENDING" | "APPROVED" | "REJECTED", createdAt: r.created_at as Date, decidedAt: (r.decided_at ?? null) as Date | null,
        decisionNote: (r.decision_note ?? null) as string | null, currentUnits: Number(r.current_units), maxUnits: r.max_units as number,
      }));
  }
  async pendingOverload(id: number): Promise<{ studentId: number; extraUnits: number } | null> {
    const r = (await this.rows("SELECT student_id, extra_units FROM overload_requests WHERE id = ? AND status = 'PENDING' FOR UPDATE", [id]))[0];
    return r ? { studentId: r.student_id, extraUnits: r.extra_units } : null;
  }
  async decideOverload(id: number, approve: boolean, adminUserId: number, note: string | null, now: Date): Promise<void> {
    await this.run("UPDATE overload_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", [approve ? "APPROVED" : "REJECTED", adminUserId, now, note, id]);
  }

  // --- announcements -----------------------------------------------------------------------------
  async insertAnnouncement(authorId: number, title: string, body: string, now: Date): Promise<number> {
    return (await this.run("INSERT INTO announcements (author_id, title, body, created_at) VALUES (?, ?, ?, ?)", [authorId, title, body, now])).insertId;
  }
  /** One SQL statement fans an announcement out to every real student's bell. */
  async notifyAllStudents(title: string, body: string, now: Date): Promise<number> {
    return (await this.run("INSERT INTO notifications (user_id, type, title, body, created_at) SELECT id, 'ANNOUNCEMENT', ?, ?, ? FROM users WHERE role = 'student' AND is_simulated = 0", [title, body.slice(0, 500), now])).affectedRows;
  }

  // --- audit -----------------------------------------------------------------------------------------
  async audit(f: { action?: string; studentId?: number; courseId?: number; page: number; pageSize: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.action) { where.push("a.action = ?"); params.push(f.action); }
    if (f.studentId) { where.push("a.student_id = ?"); params.push(f.studentId); }
    if (f.courseId) { where.push("a.course_id = ?"); params.push(f.courseId); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await this.rows(`SELECT COUNT(*) AS n FROM audit_log a ${w}`, params))[0]?.n ?? 0);
    const rows = await this.rows(
      `SELECT a.id, a.created_at, a.action, a.entity_type, a.details, au.full_name AS actor_name, su.full_name AS student_name, c.code AS course_code
       FROM audit_log a LEFT JOIN users au ON au.id = a.actor_user_id LEFT JOIN students s ON s.id = a.student_id
       LEFT JOIN users su ON su.id = s.user_id LEFT JOIN courses c ON c.id = a.course_id
       ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`, [...params, f.pageSize, (f.page - 1) * f.pageSize]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id as number, createdAt: r.created_at as Date, actorName: (r.actor_name ?? null) as string | null, action: r.action as string, entityType: r.entity_type as string,
        studentName: (r.student_name ?? null) as string | null, courseCode: (r.course_code ?? null) as string | null, details: jsonOf(r.details),
      })),
    };
  }
  async auditActions(): Promise<string[]> {
    return (await this.rows("SELECT DISTINCT action FROM audit_log ORDER BY action")).map((r) => r.action as string);
  }

  // --- analytics -----------------------------------------------------------------------------------------
  async analytics(termId: number) {
    const one = async (sql: string, params: unknown[] = []) => Number((await this.rows(sql, params))[0]?.n ?? 0);
    const enrolledSub = "(SELECT course_id, COUNT(*) AS n FROM enrollments WHERE status = 'ENROLLED' GROUP BY course_id)";
    const waitSub = "(SELECT course_id, COUNT(*) AS n FROM enrollments WHERE status = 'WAITLISTED' GROUP BY course_id)";

    const totals = {
      students: await one("SELECT COUNT(*) AS n FROM students s JOIN users u ON u.id = s.user_id WHERE u.is_simulated = 0"),
      courses: await one("SELECT COUNT(*) AS n FROM courses WHERE term_id = ?", [termId]),
      seatsTaken: await one("SELECT COUNT(*) AS n FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.term_id = ? AND e.status = 'ENROLLED'", [termId]),
      seatsTotal: await one("SELECT COALESCE(SUM(capacity), 0) AS n FROM courses WHERE term_id = ?", [termId]),
      waitlisted: await one("SELECT COUNT(*) AS n FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.term_id = ? AND e.status = 'WAITLISTED'", [termId]),
      activeHolds: await one("SELECT COUNT(*) AS n FROM holds WHERE cleared_at IS NULL"),
      pendingOverloads: await one("SELECT COUNT(*) AS n FROM overload_requests WHERE status = 'PENDING'"),
    };

    const fillByDepartment = (await this.rows(
      `SELECT d.code, d.name, COALESCE(SUM(c.capacity), 0) AS cap, COALESCE(SUM(en.n), 0) AS enr
       FROM courses c JOIN departments d ON d.id = c.department_id LEFT JOIN ${enrolledSub} en ON en.course_id = c.id
       WHERE c.term_id = ? GROUP BY d.id, d.code, d.name ORDER BY d.code`, [termId]))
      .map((r) => ({ department: r.code as string, departmentName: r.name as string, capacity: Number(r.cap), enrolled: Number(r.enr), fillRate: Number(r.cap) ? Math.round((Number(r.enr) / Number(r.cap)) * 100) : 0 }));

    const courseRows = await this.rows(
      `SELECT c.code, c.title, c.capacity, COALESCE(en.n, 0) AS enr, COALESCE(w.n, 0) AS wl
       FROM courses c LEFT JOIN ${enrolledSub} en ON en.course_id = c.id LEFT JOIN ${waitSub} w ON w.course_id = c.id WHERE c.term_id = ?`, [termId]);
    const rate = (enr: number, cap: number) => (cap ? Math.round((enr / cap) * 100) : 100);
    const topFull = courseRows
      .map((r) => ({ code: r.code as string, title: r.title as string, capacity: r.capacity as number, enrolled: Number(r.enr), waitlisted: Number(r.wl), fillRate: rate(Number(r.enr), r.capacity as number) }))
      .sort((a, b) => b.fillRate - a.fillRate || b.waitlisted - a.waitlisted || a.code.localeCompare(b.code)).slice(0, 8);
    const waitlists = courseRows.filter((r) => Number(r.wl) > 0).map((r) => ({ code: r.code as string, title: r.title as string, waitlisted: Number(r.wl) })).sort((a, b) => b.waitlisted - a.waitlisted);

    const enrollmentsOverTime = (await this.rows(
      `SELECT DATE(e.enrolled_at) AS d, COUNT(*) AS n FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE c.term_id = ? AND e.enrolled_at IS NOT NULL GROUP BY DATE(e.enrolled_at) ORDER BY d`, [termId]))
      .map((r) => ({ date: (r.d as Date).toISOString().slice(0, 10), count: Number(r.n) }));

    const perStudent = await this.rows(
      `SELECT s.id, COALESCE(SUM(CASE WHEN e.status = 'ENROLLED' THEN c.units END), 0) AS u
       FROM students s JOIN users us ON us.id = s.user_id LEFT JOIN enrollments e ON e.student_id = s.id
       LEFT JOIN courses c ON c.id = e.course_id AND c.term_id = ? WHERE us.is_simulated = 0 GROUP BY s.id`, [termId]);
    const buckets = [["0", 0, 0], ["1-6", 1, 6], ["7-12", 7, 12], ["13-18", 13, 18], ["19+", 19, 999]] as const;
    const unitsDistribution = buckets.map(([bucket, lo, hi]) => ({ bucket, students: perStudent.filter((r) => Number(r.u) >= lo && Number(r.u) <= hi).length }));

    return { totals, fillByDepartment, topFull, waitlists, enrollmentsOverTime, unitsDistribution };
  }

  async exportRows(termId: number) {
    return this.rows(
      `SELECT s.student_number, u.full_name, u.email, c.code, c.title, c.units, e.status, e.grade, e.enrolled_at, e.waitlisted_at
       FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id JOIN courses c ON c.id = e.course_id
       WHERE c.term_id = ? AND u.is_simulated = 0 ORDER BY c.code, e.status, u.full_name`, [termId]);
  }

  // --- rush simulator ---------------------------------------------------------------------------------------
  async firstProgramId(): Promise<number | null> {
    return (await this.rows("SELECT id FROM programs ORDER BY id LIMIT 1"))[0]?.id ?? null;
  }
  /** Removes every virtual student and everything they own. Order matters: audit and enrollments reference students. */
  async deleteSimulated(): Promise<number> {
    const sim = "SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.is_simulated = 1";
    await this.run(`DELETE FROM audit_log WHERE student_id IN (${sim})`);
    await this.run(`DELETE FROM enrollments WHERE student_id IN (${sim})`);
    return (await this.run("DELETE FROM users WHERE is_simulated = 1")).affectedRows;
  }
}
