import type { Pool, PoolConnection } from "./pool.js";

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isDeadlock(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ER_LOCK_DEADLOCK";
}

/**
 * Runs `work` inside one transaction, retrying the WHOLE thing on deadlock (MySQL picks a
 * victim and rolls it back; running it again is the documented remedy).
 *
 * READ COMMITTED: each statement sees the latest committed rows. Combined with the row lock
 * on the course, the head-count taken after the lock is therefore always current. Under the
 * default REPEATABLE READ a snapshot could predate the lock and show a stale count.
 */
export async function withTransaction<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      if (isDeadlock(err) && attempt < MAX_ATTEMPTS) {
        await sleep(10 * attempt + Math.random() * 20); // small jitter so the two victims do not collide again
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}
