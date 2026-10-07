import type { Queryable } from "../db/pool.js";

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  studentId?: number | null;
  courseId?: number | null;
  details?: Record<string, unknown>;
  now: Date;
}

/** Append-only. Services call this inside the same transaction as the change it describes. */
export class AuditRepository {
  constructor(private readonly db: Queryable) {}

  async record(e: AuditEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, student_id, course_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.actorUserId,
        e.action,
        e.entityType,
        e.entityId ?? null,
        e.studentId ?? null,
        e.courseId ?? null,
        e.details ? JSON.stringify(e.details) : null,
        e.now,
      ],
    );
  }
}
