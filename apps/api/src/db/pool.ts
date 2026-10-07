import mysql, { type Pool, type PoolConnection, type PoolOptions } from "mysql2/promise";
import { loadConfig, type Config } from "../config.js";

export type { Pool, PoolConnection };
/** Repositories accept either, so the same SQL runs inside or outside a transaction. */
export type Queryable = Pool | PoolConnection;

export function connectionOptions(config: Config): PoolOptions {
  const url = new URL(config.databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    charset: "utf8mb4",
    // All DATETIME columns are UTC. 'Z' makes the driver read/write them as UTC no matter the server's zone.
    timezone: "Z",
    // DECIMAL(3,2) grades come back as numbers instead of strings.
    decimalNumbers: true,
    // Certificate checking stays ON. A provider with a private CA supplies it via DB_SSL_CA instead of us turning checks off.
    ssl: config.dbSsl ? { minVersion: "TLSv1.2", rejectUnauthorized: true, ...(config.dbSslCa ? { ca: config.dbSslCa } : {}) } : undefined,
  };
}

export function createPool(config: Config = loadConfig()): Pool {
  const pool = mysql.createPool({
    ...connectionOptions(config),
    waitForConnections: true,
    // Serverless: many instances x connections can exhaust a hosted DB, so keep this small.
    connectionLimit: config.poolLimit,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  });
  // Session time zone must match too, otherwise NOW()/defaults would disagree with our UTC values.
  pool.pool.on("connection", (conn: { query: (sql: string) => void }) => conn.query("SET time_zone = '+00:00'"));
  return pool;
}

/**
 * Module-scope singleton: on Vercel a warm invocation re-uses the same pool instead of
 * opening a new connection for every request. Created lazily so importing this file is free.
 */
let shared: Pool | undefined;
export function getPool(): Pool {
  shared ??= createPool();
  return shared;
}

export async function closePool(): Promise<void> {
  if (shared) {
    await shared.end();
    shared = undefined;
  }
}
