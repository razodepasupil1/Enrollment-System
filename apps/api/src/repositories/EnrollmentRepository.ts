import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";
import { Enrollment, type EnrollmentWithCourse } from "../domain/Enrollment.js";
import type { EnrollmentStatus } from "../domain/types.js";
import type { CourseRepository } from "./CourseRepository.js";

function toEnrollment(r: RowDataPacket): Enrollment {
  return Enrollment.restore({
    id: r.id,
    studentId: r.student_id,
    courseId: r.course_id,
    status: r.status as EnrollmentStatus,
    grade: r.grade,
    enrolledAt: r.enrolled_at,
    waitlistedAt: r.waitlisted_at,
    endedAt: r.ended_at,
  });
}

export class EnrollmentRepository {
  constructor(
    private readonly db: Queryable,
    private readonly courses: CourseRepository,
  ) {}

  async findById(id: number, opts: { forUpdate?: boolean } = {}): Promise<Enrollment | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM enrollments WHERE id = ?${opts.forUpdate ? " FOR UPDATE" : ""}`,
      [id],
    );
    return rows[0] ? toEnrollment(rows[0]) : null;
  }

  /**
   * Head-count of taken seats. Seat counts are always derived with COUNT(*) inside the
   * locked transaction instead of a stored counter: there is no second number that could drift
   * out of sync with the rows, and the course-row lock already serialises all writers.
   */
  async countByStatus(courseId: number, status: EnrollmentStatus): Promise<number> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ? AND status = ?",
      [courseId, status],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Seat and waitlist counts for many courses in ONE query (used by the catalog and bulk validation). */
  async countsByCourse(courseIds: readonly number[]): Promise<Map<number, { enrolled: number; waitlisted: number }>> {
    const out = new Map<number, { enrolled: number; waitlisted: number }>();
    for (const id of courseIds) out.set(id, { enrolled: 0, waitlisted: 0 });
    if (courseIds.length === 0) return out;
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT course_id, status, COUNT(*) AS n FROM enrollments
       WHERE course_id IN (?) AND status IN ('ENROLLED','WAITLISTED') GROUP BY course_id, status`,
      [courseIds],
    );
    for (const r of rows) {
      const c = out.get(r.course_id as number)!;
      if (r.status === "ENROLLED") c.enrolled = Number(r.n);
      else c.waitlisted = Number(r.n);
    }
    return out;
  }

  /** The student's ENROLLED + WAITLISTED enrollments for one term, each with its course. */
  async findActiveWithCourses(studentId: number, termId: number): Promise<EnrollmentWithCourse[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT e.* FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.student_id = ? AND c.term_id = ? AND e.status IN ('ENROLLED','WAITLISTED')
       ORDER BY e.id`,
      [studentId, termId],
    );
    return this.withCourses(rows.map(toEnrollment));
  }

  /** Waitlisted enrollments for a course in promotion order: earliest first, id breaks ties. */
  async waitlistQueue(courseId: number): Promise<Enrollment[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT * FROM enrollments WHERE course_id = ? AND status = 'WAITLISTED' ORDER BY waitlisted_at, id",
      [courseId],
    );
    return rows.map(toEnrollment);
  }

  /** 1-based position, derived from ordering; never stored (so nothing to renumber after a drop). */
  async waitlistPosition(enrollmentId: number): Promise<number | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) + 1 AS pos FROM enrollments me
       JOIN enrollments other
         ON other.course_id = me.course_id AND other.status = 'WAITLISTED'
        AND (other.waitlisted_at < me.waitlisted_at
             OR (other.waitlisted_at = me.waitlisted_at AND other.id < me.id))
       WHERE me.id = ? AND me.status = 'WAITLISTED'`,
      [enrollmentId],
    );
    // COUNT(*)+1 is 1 even when `me` does not exist/is not waitlisted, so confirm separately.
    const [exists] = await this.db.query<RowDataPacket[]>(
      "SELECT 1 FROM enrollments WHERE id = ? AND status = 'WAITLISTED'",
      [enrollmentId],
    );
    return exists.length > 0 ? Number(rows[0]?.pos ?? 1) : null;
  }

  async insert(enrollment: Enrollment): Promise<void> {
    const s = enrollment.toSnapshot();
    const [res] = await this.db.query<ResultSetHeader>(
      `INSERT INTO enrollments (student_id, course_id, status, grade, enrolled_at, waitlisted_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.studentId, s.courseId, s.status, s.grade, s.enrolledAt, s.waitlistedAt, s.endedAt],
    );
    enrollment.assignId(res.insertId);
  }

  async save(enrollment: Enrollment): Promise<void> {
    const s = enrollment.toSnapshot();
    await this.db.query(
      `UPDATE enrollments
       SET status = ?, grade = ?, enrolled_at = ?, waitlisted_at = ?, ended_at = ?
       WHERE id = ?`,
      [s.status, s.grade, s.enrolledAt, s.waitlistedAt, s.endedAt, s.id],
    );
  }

  private async withCourses(enrollments: Enrollment[]): Promise<EnrollmentWithCourse[]> {
    const courses = await this.courses.findByIds([...new Set(enrollments.map((e) => e.courseId))]);
    const byId = new Map(courses.map((c) => [c.id, c]));
    return enrollments.flatMap((enrollment) => {
      const course = byId.get(enrollment.courseId);
      return course ? [{ enrollment, course }] : [];
    });
  }
}
