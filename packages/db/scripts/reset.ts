import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dbEnv, isLocalDatabaseUrl } from "../src/env";
import { MIGRATIONS_DIR } from "./paths";

/** Drop everything and re-run migrations. Local databases only. */
const { DATABASE_URL } = dbEnv();
if (!isLocalDatabaseUrl(DATABASE_URL)) {
  console.error("✖ db:reset only runs against local databases.");
  process.exit(1);
}
const client = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await client.unsafe(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
  );
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  console.log("✔ database reset and migrated");
} catch (error) {
  console.error("✖ reset failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
