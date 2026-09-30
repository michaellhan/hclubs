import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dbEnv } from "../src/env";
import { MIGRATIONS_DIR } from "./paths";

const { DATABASE_URL } = dbEnv();
const client = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  console.log("✔ migrations applied");
} catch (error) {
  console.error("✖ migration failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
