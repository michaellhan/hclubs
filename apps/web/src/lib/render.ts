import type { DuesValue, HoursPerWeek, MembershipEstimate } from "@hci/core/browser";
import { formatRange } from "./format";

/** Display renderers for structured claim values, shared by profile and compare pages. */
export function renderMembers(v: unknown): string {
  const m = v as MembershipEstimate;
  return m.kind === "exact" ? `${m.count} members` : `${formatRange({ min: m.min, max: m.max })} members`;
}

export function renderHours(v: unknown): string {
  const h = v as HoursPerWeek;
  const q = h.qualifier === "comp_period" ? " during comp" : h.qualifier === "member" ? " as a member" : "";
  return `${formatRange(h, "h/week")}${q}`;
}

/**
 * Dues as the source states them. "No dues required" (the College directory's wording)
 * never becomes "free": other costs may still apply. Unknown stays unknown, and the
 * extractor's `note` (a verbatim source sentence) is never published.
 */
export function renderDues(v: unknown): string {
  const d = v as DuesValue;
  if (d.hasDues === false) return "No dues required";
  // "$20 per 6 months" when the source says what the amount covers (2026-10-13).
  const amount = d.amountUsd != null ? (d.period ? `$${d.amountUsd} per ${d.period}` : `$${d.amountUsd} dues`) : null;
  if (d.hasDues === true) return amount ?? "Dues (amount not stated)";
  return amount ?? "Unknown";
}
