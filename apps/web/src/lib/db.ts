import { getDb } from "@hci/db";

/** Server-only database access for route handlers and server components. */
export const db = () => getDb();
