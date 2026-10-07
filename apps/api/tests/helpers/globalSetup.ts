import { dropAllTables, migrate } from "../../src/db/migrate.js";
import { assertTestDatabase } from "./db.js";

/** Runs once before all tests: fresh schema in the test database. */
export default async function setup(): Promise<void> {
  assertTestDatabase();
  await dropAllTables();
  await migrate();
}
