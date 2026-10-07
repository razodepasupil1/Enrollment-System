import "./env";
import { dropAllTables, migrate } from "../../api/src/db/migrate";

export default async function setup(): Promise<void> {
  const name = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to run against "${name}" (must end with _test).`);
  await dropAllTables();
  await migrate();
}
