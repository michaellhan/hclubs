import { and, eq, inArray } from "drizzle-orm";
import { getField, isFieldKey } from "@hci/core";
import { schema, type Db } from "@hci/db";

/**
 * `pnpm hci explain <slug> [field…]`: every claim behind a club's fields — value, status,
 * evidence (source, tier, extractor, confidence, a short quote) — and which one the site
 * shows, with the field's resolution rule. For answering "where did this number come
 * from?" and "why does the page say X?" without opening the database. Read-only.
 */

const short = (v: unknown, n = 90) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Claim ids the projection currently displays for each field. */
function displayedIds(fields: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!fields || typeof fields !== "object") return out;
  for (const [key, f] of Object.entries(fields as Record<string, unknown>)) {
    const ids = new Set<string>();
    const field = f as { kind?: string; current?: { claimId?: string }; values?: { claimId?: string }[] };
    if (field.kind === "single" && field.current?.claimId) ids.add(field.current.claimId);
    if (field.kind === "multi") for (const v of field.values ?? []) if (v.claimId) ids.add(v.claimId);
    out.set(key, ids);
  }
  return out;
}

export async function explainClub(db: Db, slug: string, onlyFields: string[] = []): Promise<string> {
  let [club] = await db.select().from(schema.club).where(eq(schema.club.slug, slug));
  if (!club) {
    const [old] = await db
      .select({ clubId: schema.clubSlugHistory.clubId })
      .from(schema.clubSlugHistory)
      .where(eq(schema.clubSlugHistory.slug, slug));
    if (old) [club] = await db.select().from(schema.club).where(eq(schema.club.id, old.clubId));
  }
  if (!club) throw new Error(`no club with slug ${slug}`);
  for (const f of onlyFields) if (!isFieldKey(f)) throw new Error(`unknown field ${f}`);

  const ids = [club.id];
  // Claims made about clubs merged into this one still count (the resolver follows the chain).
  const merged = await db
    .select({ id: schema.club.id })
    .from(schema.club)
    .where(eq(schema.club.mergedIntoClubId, club.id));
  ids.push(...merged.map((m) => m.id));

  const claims = await db
    .select()
    .from(schema.claim)
    .where(
      and(
        inArray(schema.claim.clubId, ids),
        ...(onlyFields.length ? [inArray(schema.claim.fieldKey, onlyFields)] : []),
      ),
    );
  const evidence = claims.length
    ? await db
        .select({
          claimId: schema.claimEvidence.claimId,
          observedAt: schema.claimEvidence.observedAt,
          quote: schema.claimEvidence.evidenceQuote,
          method: schema.claimEvidence.extractionMethod,
          extractor: schema.claimEvidence.extractorName,
          version: schema.claimEvidence.extractorVersion,
          confidence: schema.claimEvidence.confidence,
          url: schema.source.url,
          sourceType: schema.source.sourceType,
          tier: schema.source.trustTier,
        })
        .from(schema.claimEvidence)
        .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
        .where(
          inArray(
            schema.claimEvidence.claimId,
            claims.map((c) => c.id),
          ),
        )
    : [];
  const evBy = new Map<string, typeof evidence>();
  for (const e of evidence) evBy.set(e.claimId, [...(evBy.get(e.claimId) ?? []), e]);
  const shown = displayedIds(club.fields);
  const cycleShown = new Set<string>();
  // Cycle fields are displayed per cycle; treat every active cycle claim's winner as shown via the cycle projection.
  const cycles = await db.select().from(schema.recruitingCycle).where(inArray(schema.recruitingCycle.clubId, ids));
  for (const cy of cycles) for (const set of displayedIds(cy.fields).values()) for (const id of set) cycleShown.add(id);

  const lines: string[] = [];
  lines.push(`${club.canonicalName}  (${club.slug}, ${club.recordState})`);
  if (merged.length) lines.push(`  includes claims of ${merged.length} merged record(s)`);
  lines.push(`  completeness ${club.completeness ?? "—"} · resolved ${day(club.updatedAt)}`);
  const byField = new Map<string, typeof claims>();
  for (const c of claims) byField.set(c.fieldKey, [...(byField.get(c.fieldKey) ?? []), c]);
  const order = [...byField.keys()].sort();
  for (const key of order) {
    const list = byField.get(key)!;
    const def = isFieldKey(key) ? getField(key) : null;
    const display = shown.get(key) ?? new Set<string>();
    lines.push("");
    lines.push(
      `${key}${def ? `  [${def.cardinality}, ${def.resolution}${def.allowInferred ? "" : ", stated only"}]` : ""}`,
    );
    const rank = (s: string) => ({ active: 0, superseded: 1, retracted: 2, rejected: 3 })[s] ?? 4;
    list.sort((a, b) => rank(a.status) - rank(b.status) || b.lastObservedAt.getTime() - a.lastObservedAt.getTime());
    for (const c of list) {
      const mark =
        display.has(c.id) || cycleShown.has(c.id) ? "▶ shown" : c.status === "active" ? "  active" : `  ${c.status}`;
      lines.push(
        `  ${mark}  ${short(c.value)}${c.termKey ? `  (${c.termKey})` : ""}  · ${c.assertionKind} · seen ${day(c.firstObservedAt)}→${day(c.lastObservedAt)}`,
      );
      if (c.status !== "active" && c.statusReason) lines.push(`           why: ${short(c.statusReason, 110)}`);
      // One line per source page and extractor; re-runs by later versions are folded in.
      const groups = new Map<string, { e: (typeof evidence)[number]; versions: string[] }>();
      for (const e of (evBy.get(c.id) ?? []).sort((a, b) => a.tier - b.tier)) {
        const key = `${e.url}|${e.extractor}|${e.quote ?? ""}`;
        const g = groups.get(key);
        if (g) g.versions.push(e.version);
        else groups.set(key, { e, versions: [e.version] });
      }
      for (const { e, versions } of groups.values()) {
        const v =
          versions.length > 1
            ? `${versions[0]}…${versions[versions.length - 1]} (${versions.length} runs)`
            : versions[0];
        lines.push(
          `           tier ${e.tier} ${e.sourceType} ${host(e.url)} · ${e.extractor}@${v} (${e.method}) · conf ${e.confidence.toFixed(2)} · ${day(e.observedAt)}`,
        );
        if (e.quote) lines.push(`             “${short(e.quote.replace(/\s+/g, " "), 120)}”`);
      }
    }
  }
  if (!order.length) lines.push("", "No claims.");
  return lines.join("\n");
}
