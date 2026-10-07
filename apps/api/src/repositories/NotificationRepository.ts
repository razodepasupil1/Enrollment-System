import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";

export interface NewNotification {
  userId: number;
  type: string;
  title: string;
  body: string;
  now: Date;
}

export class NotificationRepository {
  constructor(private readonly db: Queryable) {}

  async create(n: NewNotification): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      "INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [n.userId, n.type, n.title, n.body, n.now],
    );
    return res.insertId;
  }
}
