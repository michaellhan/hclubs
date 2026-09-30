import { createHmac, randomBytes } from "node:crypto";
import { headers } from "next/headers";

// Per-process fallback so local dev works without configuration. Production sets
// SUBMISSION_HMAC_SECRET so refs are stable across instances.
const FALLBACK_SECRET = randomBytes(32).toString("hex");

/**
 * Opaque, non-reversible submitter reference for rate limiting (CLAUDE.md §14): a keyed
 * hash of the client address and the current UTC day. The raw address is never stored,
 * and refs rotate daily so submissions can't be linked over time.
 */
export async function submitterRef(now: Date): Promise<string | null> {
  const h = await headers();
  const addr = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  if (!addr) return null;
  const secret = process.env.SUBMISSION_HMAC_SECRET || FALLBACK_SECRET;
  return createHmac("sha256", secret)
    .update(`${addr}|${now.toISOString().slice(0, 10)}`)
    .digest("base64url")
    .slice(0, 32);
}
