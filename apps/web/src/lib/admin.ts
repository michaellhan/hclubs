/**
 * Internal tooling guard. The review UI has no authentication, so it exists only under
 * `next dev` (its `.dev.tsx` page isn't part of the static export at all).
 */
export function adminEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
