import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";

export class OverloadRepository {
  constructor(private readonly db: Queryable) {}

  /** Extra units granted to a student for a term by APPROVED requests (they add up). */
  async approvedUnits(studentId: number, termId: number): Promise<number> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(extra_units), 0) AS units FROM overload_requests
       WHERE student_id = ? AND term_id = ? AND status = 'APPROVED'`,
      [studentId, termId],
    );
    return Number(rows[0]?.units ?? 0);
  }

  async create(r: { studentId: number; termId: number; extraUnits: number; reason: string; now: Date }): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      `INSERT INTO overload_requests (student_id, term_id, extra_units, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [r.studentId, r.termId, r.extraUnits, r.reason, r.now],
    );
    return res.insertId;
  }
}
