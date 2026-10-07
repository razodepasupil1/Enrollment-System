import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";
import { connectionOptions } from "./pool.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/**
 * Applies every numbered .sql file that has not run yet, in order, and records it.
 * Plain SQL on purpose: students can read and defend every table. Returns the files applied.
 */
export async function migrate(): Promise<string[]> {
  const conn = await mysql.createConnection({ ...connectionOptions(loadConfig()), multipleStatements: true });
  const applied: string[] = [];
  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    VARCHAR(100) PRIMARY KEY,
         applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB`,
    );
    const [rows] = await conn.query("SELECT version FROM schema_migrations");
    const done = new Set((rows as Array<{ version: string }>).map((r) => r.version));
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(MIGRATIONS_DIR + file, "utf8");
      await conn.query(sql); // DDL auto-commits in MySQL, so a failure stops here and the file is not recorded
      await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      applied.push(file);
    }
  } finally {
    await conn.end();
  }
  return applied;
}

/** Drops every table in the configured database (dev/test only). */
export async function dropAllTables(): Promise<void> {
  const config = loadConfig();
  if (config.nodeEnv === "production") throw new Error("Refusing to drop tables when NODE_ENV=production.");
  const conn = await mysql.createConnection(connectionOptions(config));
  try {
    const [rows] = await conn.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const r of rows as Array<{ name: string }>) await conn.query(`DROP TABLE IF EXISTS \`${r.name}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
