import { loadConfig } from "../../src/config.js";

/** Last line of defence: refuse to run destructive test helpers against anything not named *_test. */
export function assertTestDatabase(): void {
  const name = new URL(loadConfig().databaseUrl).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to run tests against database "${name}" (must end with _test).`);
}
