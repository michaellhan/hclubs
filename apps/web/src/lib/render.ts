import type { DuesValue, HoursPerWeek, MembershipEstimate } from "@hci/core";
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

export function renderDues(v: unknown): string {
  const d = v as DuesValue;
  if (d.hasDues === false) return "No dues";
  const amount = d.amountUsd != null ? `$${d.amountUsd}` : "Dues";
  return d.note ? `${amount} — ${d.note}` : amount;
}
