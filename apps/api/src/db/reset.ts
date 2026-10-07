import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { dropAllTables, migrate } from "./migrate.js";
import { closePool, getPool } from "./pool.js";
import { seedDatabase } from "./seed.js";

/** `pnpm db:reset`: drop everything, re-apply migrations, reload demo data. Dev/test only. */
export async function resetDatabase(): Promise<void> {
  if (loadConfig().nodeEnv === "production") throw new Error("Refusing to reset when NODE_ENV=production.");
  await dropAllTables();
  await migrate();
  await seedDatabase(getPool());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetDatabase()
    .then(() => console.log("Database reset and re-seeded."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
