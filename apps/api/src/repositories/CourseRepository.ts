import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";
import { Course } from "../domain/Course.js";
import type { Day, Meeting, PrerequisiteRef } from "../domain/types.js";

const SELECT_COURSE = `
  SELECT c.*, d.code AS department_code
  FROM courses c JOIN departments d ON d.id = c.department_id`;

export class CourseRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: number): Promise<Course | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(`${SELECT_COURSE} WHERE c.id = ?`, [id]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findByIds(ids: readonly number[]): Promise<Course[]> {
    if (ids.length === 0) return [];
    const [rows] = await this.db.query<RowDataPacket[]>(`${SELECT_COURSE} WHERE c.id IN (?)`, [ids]);
    return this.hydrate(rows);
  }

  async findByTerm(termId: number): Promise<Course[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `${SELECT_COURSE} WHERE c.term_id = ? ORDER BY c.code`,
      [termId],
    );
    return this.hydrate(rows);
  }

  /**
   * Takes the row lock that serialises everyone enrolling in / dropping from this course.
   * Must run inside a transaction. Returns false when the course does not exist.
   */
  async lockById(id: number): Promise<boolean> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT id FROM courses WHERE id = ? FOR UPDATE", [id]);
    return rows.length > 0;
  }

  private async hydrate(rows: RowDataPacket[]): Promise<Course[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as number);
    const codes = [...new Set(rows.map((r) => r.code as string))];

    const [meetings] = await this.db.query<RowDataPacket[]>(
      "SELECT course_id, day, start_min, end_min FROM course_meetings WHERE course_id IN (?) ORDER BY id",
      [ids],
    );
    const [prereqs] = await this.db.query<RowDataPacket[]>(
      "SELECT course_code, prereq_code, min_grade FROM prerequisites WHERE course_code IN (?) ORDER BY id",
      [codes],
    );
    const [coreqs] = await this.db.query<RowDataPacket[]>(
      "SELECT course_code, coreq_code FROM corequisites WHERE course_code IN (?) ORDER BY id",
      [codes],
    );

    return rows.map((r) => {
      const meets: Meeting[] = meetings
        .filter((m) => m.course_id === r.id)
        .map((m) => ({ day: m.day as Day, startMin: m.start_min as number, endMin: m.end_min as number }));
      const pre: PrerequisiteRef[] = prereqs
        .filter((p) => p.course_code === r.code)
        .map((p) => ({ code: p.prereq_code as string, minGrade: p.min_grade as number | null }));
      return new Course({
        id: r.id,
        code: r.code,
        title: r.title,
        description: r.description ?? "",
        units: r.units,
        capacity: r.capacity,
        termId: r.term_id,
        instructorId: r.instructor_id,
        department: r.department_code,
        room: r.room,
        meetings: meets,
        prerequisites: pre,
        corequisites: coreqs.filter((c) => c.course_code === r.code).map((c) => c.coreq_code as string),
        dropDeadline: r.drop_deadline,
      });
    });
  }
}
