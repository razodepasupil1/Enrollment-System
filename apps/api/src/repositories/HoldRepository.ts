import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";
import type { Hold, HoldType } from "../domain/types.js";

const toHold = (r: RowDataPacket): Hold => ({
  id: r.id,
  studentId: r.student_id,
  type: r.type as HoldType,
  reason: r.reason,
  placedAt: r.placed_at,
  clearedAt: r.cleared_at,
});

export class HoldRepository {
  constructor(private readonly db: Queryable) {}

  async findActiveByStudent(studentId: number): Promise<Hold[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT * FROM holds WHERE student_id = ? AND cleared_at IS NULL ORDER BY id",
      [studentId],
    );
    return rows.map(toHold);
  }

  async findById(id: number): Promise<Hold | null> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT * FROM holds WHERE id = ?", [id]);
    return rows[0] ? toHold(rows[0]) : null;
  }

  async create(h: { studentId: number; type: HoldType; reason: string; placedBy: number | null; now: Date }): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      "INSERT INTO holds (student_id, type, reason, placed_by, placed_at) VALUES (?, ?, ?, ?, ?)",
      [h.studentId, h.type, h.reason, h.placedBy, h.now],
    );
    return res.insertId;
  }

  async clear(id: number, clearedBy: number | null, now: Date): Promise<boolean> {
    const [res] = await this.db.query<ResultSetHeader>(
      "UPDATE holds SET cleared_at = ?, cleared_by = ? WHERE id = ? AND cleared_at IS NULL",
      [now, clearedBy, id],
    );
    return res.affectedRows > 0;
  }
}
