import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { dbEnv } from "./env";

export type Schema = typeof schema;
/** Driver-agnostic database handle (postgres-js in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the db or an open transaction. */
export type Queryable = Db | Tx;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(url: string = dbEnv().DATABASE_URL, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, {
    max: options.max ?? 5,
    // Unnamed statements: compatible with transaction poolers (Neon/Supabase) and the
    // multiplexed PGlite dev server, at a negligible cost at our scale.
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, close: () => client.end({ timeout: 5 }) };
}

const globalForDb = globalThis as unknown as { __hciDb?: DbHandle };

/** Process-wide singleton for the web app (survives Next.js dev hot reloads). */
export function getDb(): Db {
  globalForDb.__hciDb ??= createDb();
  return globalForDb.__hciDb.db;
}
