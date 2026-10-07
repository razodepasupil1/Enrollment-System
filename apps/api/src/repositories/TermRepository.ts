import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";
import { Term } from "../domain/Term.js";
import type { ClassStanding } from "../domain/types.js";

export class TermRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: number): Promise<Term | null> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT * FROM terms WHERE id = ?", [id]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findCurrent(): Promise<Term | null> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT * FROM terms WHERE is_current = 1 LIMIT 1");
    return (await this.hydrate(rows))[0] ?? null;
  }

  async list(): Promise<Term[]> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT * FROM terms ORDER BY registration_opens_at DESC");
    return this.hydrate(rows);
  }

  private async hydrate(rows: RowDataPacket[]): Promise<Term[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as number);
    const [windows] = await this.db.query<RowDataPacket[]>(
      "SELECT term_id, class_standing, opens_at FROM term_priority_windows WHERE term_id IN (?)",
      [ids],
    );
    return rows.map((r) => {
      const priorityOpenings: Partial<Record<ClassStanding, Date>> = {};
      for (const w of windows.filter((w) => w.term_id === r.id)) {
        priorityOpenings[w.class_standing as ClassStanding] = w.opens_at as Date;
      }
      return new Term({
        id: r.id,
        name: r.name,
        isCurrent: r.is_current === 1,
        registrationOpensAt: r.registration_opens_at,
        registrationClosesAt: r.registration_closes_at,
        dropDeadline: r.drop_deadline,
        endsAt: r.ends_at,
        priorityOpenings,
      });
    });
  }
}
