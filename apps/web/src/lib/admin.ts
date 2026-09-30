/**
 * Internal tooling guard. The review UI has no authentication yet, so it is available
 * only in development — or in production when ENABLE_ADMIN=1 is set deliberately
 * (never set it on a public deployment until auth exists).
 */
export function adminEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_ADMIN === "1";
}
