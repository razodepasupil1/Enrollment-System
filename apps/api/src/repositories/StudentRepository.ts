import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";
import { Student } from "../domain/Student.js";
import type { GradedCourse, StudentStatus } from "../domain/types.js";

/** The domain Student has no user id (it is an auth concern), but notifications need one. */
export interface LoadedStudent {
  student: Student;
  userId: number;
}

const SELECT_STUDENT = `
  SELECT s.*, u.full_name, u.email, p.code AS program_code
  FROM students s
  JOIN users u ON u.id = s.user_id
  JOIN programs p ON p.id = s.program_id`;

export class StudentRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: number): Promise<LoadedStudent | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(`${SELECT_STUDENT} WHERE s.id = ?`, [id]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findByUserId(userId: number): Promise<LoadedStudent | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(`${SELECT_STUDENT} WHERE s.user_id = ?`, [userId]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  /** Row lock for the student, always taken BEFORE the course lock (fixed order prevents deadlocks). */
  async lockById(id: number): Promise<boolean> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT id FROM students WHERE id = ? FOR UPDATE", [id]);
    return rows.length > 0;
  }

  private async hydrate(rows: RowDataPacket[]): Promise<LoadedStudent[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as number);
    // Transcript = every graded enrollment (passed AND failed); the domain decides what counts.
    const [grades] = await this.db.query<RowDataPacket[]>(
      `SELECT e.student_id, c.code, c.title, c.units, c.term_id, e.grade
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.student_id IN (?) AND e.status IN ('COMPLETED','FAILED') AND e.grade IS NOT NULL`,
      [ids],
    );
    return rows.map((r) => {
      const transcript: GradedCourse[] = grades
        .filter((g) => g.student_id === r.id)
        .map((g) => ({ code: g.code, title: g.title, units: g.units, grade: g.grade, termId: g.term_id }));
      return {
        userId: r.user_id as number,
        student: new Student({
          id: r.id,
          studentNumber: r.student_number,
          fullName: r.full_name,
          email: r.email,
          program: r.program_code,
          yearLevel: r.year_level,
          maxUnits: r.max_units,
          status: r.status as StudentStatus,
          transcript,
        }),
      };
    });
  }
}
