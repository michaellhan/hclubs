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
  if (d.hasDues === true) return d.amountUsd != null ? `$${d.amountUsd} dues` : "Dues (amount not stated)";
  return d.amountUsd != null ? `$${d.amountUsd} dues` : "Unknown";
}
