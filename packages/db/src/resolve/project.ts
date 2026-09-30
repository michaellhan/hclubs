import { and, eq, inArray, sql } from "drizzle-orm";
import {
  FIELDS,
  RESOLVER_VERSION,
  dateValueEnd,
  dateValueStart,
  getField,
  normalizeAcronym,
  normalizeName,
  normalizeUrl,
  resolveField,
  type AliasValue,
  type ClaimInput,
  type DateValue,
  type EvidenceInput,
  type FieldKey,
  type HoursPerWeek,
  type LinkValue,
  type MembershipEstimate,
  type ResolvedField,
  type ResolvedValue,
  type SourceType,
  type StageValue,
} from "@hci/core";
import type { Db, Queryable } from "../client";
import {
  category,
  claim,
  claimEvidence,
  club,
  clubAlias,
  clubCategory,
  clubLink,
  clubSearchDocument,
  membershipEstimate,
  recruitingCycle,
  recruitingStage,
  source,
} from "../schema";

/**
 * Projection writer: loads a club's claims + evidence, runs the pure resolver from
 * @hci/core, and rewrites the club's projection rows. CLAUDE.md §5.1 "golden rule":
 * this is the ONLY code that writes projection tables/columns.
 */

type ClubFieldKey = Extract<FieldKey, `club.${string}`>;
type CycleFieldKey = Extract<FieldKey, `cycle.${string}`>;

const CLUB_FIELD_KEYS = (Object.keys(FIELDS) as FieldKey[]).filter((k): k is ClubFieldKey => k.startsWith("club."));
const CYCLE_FIELD_KEYS = (Object.keys(FIELDS) as FieldKey[]).filter((k): k is CycleFieldKey => k.startsWith("cycle."));

/** Fields that count toward the completeness score shown on profiles. */
const COMPLETENESS_FIELDS: ClubFieldKey[] = [
  "club.short_description",
  "club.long_description",
  "club.category",
  "club.link",
  "club.join_mode",
  "club.org_type",
  "club.recognition_status",
  "club.freshmen_eligible",
  "club.hours_per_week",
  "club.member_count",
];

/** Display payload stored in `club.fields` / `recruiting_cycle.fields`. */
export type StoredField =
  | { kind: "single"; current: ResolvedValue; alternatives: ResolvedValue[]; conflict: boolean }
  | { kind: "multi"; values: ResolvedValue[] };

async function loadClaims(
  db: Queryable,
  where: ReturnType<typeof and>,
): Promise<(ClaimInput & { cycleId: string | null })[]> {
  const rows = await db
    .select({
      id: claim.id,
      cycleId: claim.recruitingCycleId,
      fieldKey: claim.fieldKey,
      value: claim.value,
      normalizedValue: claim.normalizedValue,
      assertionKind: claim.assertionKind,
      status: claim.status,
      termKey: claim.termKey,
      validFrom: claim.validFrom,
      validUntil: claim.validUntil,
      asOfDate: claim.asOfDate,
      evSourceId: claimEvidence.sourceId,
      evObservedAt: claimEvidence.observedAt,
      evMethod: claimEvidence.extractionMethod,
      evDirect: claimEvidence.isDirect,
      evConfidence: claimEvidence.confidence,
      evQuote: claimEvidence.evidenceQuote,
      srcType: source.sourceType,
      srcTier: source.trustTier,
      srcUrl: source.url,
      srcTitle: source.title,
      srcFixture: source.isFixture,
    })
    .from(claim)
    .innerJoin(claimEvidence, eq(claimEvidence.claimId, claim.id))
    .innerJoin(source, eq(source.id, claimEvidence.sourceId))
    .where(where)
    .orderBy(claim.id);

  const byId = new Map<string, ClaimInput & { cycleId: string | null; evidence: EvidenceInput[] }>();
  for (const r of rows) {
    let c = byId.get(r.id);
    if (!c) {
      c = {
        id: r.id,
        cycleId: r.cycleId,
        fieldKey: r.fieldKey,
        value: r.value,
        normalizedValue: r.normalizedValue,
        assertionKind: r.assertionKind,
        status: r.status,
        termKey: r.termKey,
        validFrom: r.validFrom,
        validUntil: r.validUntil,
        asOfDate: r.asOfDate,
        evidence: [],
      };
      byId.set(r.id, c);
    }
    c.evidence.push({
      sourceId: r.evSourceId,
      sourceType: r.srcType as SourceType,
      trustTier: r.srcTier,
      sourceUrl: r.srcUrl,
      sourceTitle: r.srcTitle,
      isFixture: r.srcFixture,
      extractionMethod: r.evMethod as EvidenceInput["extractionMethod"],
      isDirect: r.evDirect,
      confidence: r.evConfidence,
      observedAt: r.evObservedAt,
      quote: r.evQuote,
    });
  }
  return [...byId.values()];
}

function toStored(resolved: ResolvedField): StoredField | null {
  if (resolved.current) {
    return {
      kind: "single",
      current: resolved.current,
      alternatives: resolved.alternatives,
      conflict: resolved.conflict,
    };
  }
  if (resolved.values.length > 0) return { kind: "multi", values: resolved.values };
  return null;
}

function resolveAll<K extends FieldKey>(
  keys: readonly K[],
  claims: readonly ClaimInput[],
  now: Date,
): Map<K, ResolvedField> {
  const out = new Map<K, ResolvedField>();
  for (const key of keys) out.set(key, resolveField(getField(key), claims, now));
  return out;
}

const cur = <T>(m: Map<string, ResolvedField>, key: string): T | null =>
  (m.get(key)?.current?.value as T | undefined) ?? null;
const vals = <T>(m: Map<string, ResolvedField>, key: string): ResolvedValue<T>[] =>
  (m.get(key)?.values ?? []) as ResolvedValue<T>[];

export interface ResolveStats {
  clubs: number;
  failed: number;
  errors: { clubId: string; error: string }[];
}

/** Resolve one club inside a transaction. Throws on failure (caller isolates failures). */
export async function resolveClub(db: Db, clubId: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const claims = await loadClaims(tx, and(eq(claim.clubId, clubId)));
    const clubClaims = claims.filter((c) => c.cycleId === null);
    const resolved = resolveAll(CLUB_FIELD_KEYS, clubClaims, now);

    const fields: Record<string, StoredField> = {};
    for (const [key, r] of resolved) {
      const stored = toStored(r);
      if (stored) fields[key] = stored;
    }

    const name = cur<string>(resolved, "club.name");
    const acronym = cur<string>(resolved, "club.acronym");
    const hours = cur<HoursPerWeek>(resolved, "club.hours_per_week");
    const members = cur<MembershipEstimate>(resolved, "club.member_count");
    const joinModes = vals<string>(resolved, "club.join_mode").map((v) => v.value);
    const sourceIds = new Set(claims.flatMap((c) => c.evidence.map((e) => e.sourceId)));
    const lastObserved = claims.flatMap((c) => c.evidence.map((e) => e.observedAt.getTime()));
    const completeness = COMPLETENESS_FIELDS.filter((k) => fields[k] !== undefined).length / COMPLETENESS_FIELDS.length;

    await tx
      .update(club)
      .set({
        ...(name ? { canonicalName: name } : {}),
        acronym,
        shortDescription: cur<string>(resolved, "club.short_description"),
        longDescription: cur<string>(resolved, "club.long_description"),
        orgType: cur<string>(resolved, "club.org_type"),
        recognitionStatus: cur<string>(resolved, "club.recognition_status") ?? "unknown",
        activityStatus: cur<string>(resolved, "club.activity_status") ?? "unknown",
        affiliationScope: cur<string>(resolved, "club.affiliation_scope") ?? "unknown",
        joinModes,
        freshmenEligible: cur<boolean>(resolved, "club.freshmen_eligible"),
        hoursPerWeekMin: hours?.min ?? null,
        hoursPerWeekMax: hours?.max ?? null,
        memberCountMin: members ? (members.kind === "exact" ? members.count : members.min) : null,
        memberCountMax: members ? (members.kind === "exact" ? members.count : members.max) : null,
        fields,
        completeness: Math.round(completeness * 100) / 100,
        sourceCount: sourceIds.size,
        conflictFields: [...resolved].filter(([, r]) => r.conflict).map(([k]) => k),
        lastObservedAt: lastObserved.length > 0 ? new Date(Math.max(...lastObserved)) : null,
        resolvedAt: now,
        resolverVersion: RESOLVER_VERSION,
      })
      .where(eq(club.id, clubId));

    // Aliases (+ acronym as an alias kind so search can find it).
    await tx.delete(clubAlias).where(eq(clubAlias.clubId, clubId));
    const aliasRows = new Map<string, typeof clubAlias.$inferInsert>();
    for (const a of vals<AliasValue>(resolved, "club.alias")) {
      const normalized = normalizeName(a.value.name);
      if (normalized)
        aliasRows.set(normalized, {
          clubId,
          alias: a.value.name,
          normalizedAlias: normalized,
          kind: a.value.kind,
          claimId: a.claimId,
        });
    }
    const acr = resolved.get("club.acronym")?.current;
    if (acronym && acr) {
      const normalized = normalizeName(acronym);
      if (normalized)
        aliasRows.set(normalized, {
          clubId,
          alias: acronym,
          normalizedAlias: normalized,
          kind: "acronym",
          claimId: acr.claimId,
        });
    }
    if (aliasRows.size > 0) await tx.insert(clubAlias).values([...aliasRows.values()]);

    // Categories.
    await tx.delete(clubCategory).where(eq(clubCategory.clubId, clubId));
    const cats = vals<string>(resolved, "club.category");
    if (cats.length > 0) {
      const catRows = await tx
        .select({ id: category.id, slug: category.slug })
        .from(category)
        .where(
          inArray(
            category.slug,
            cats.map((c) => c.value),
          ),
        );
      const bySlug = new Map(catRows.map((c) => [c.slug, c.id]));
      const rows = cats
        .map((c, i) => ({ categoryId: bySlug.get(c.value), claimId: c.claimId, isPrimary: i === 0 }))
        .filter((r): r is { categoryId: string; claimId: string; isPrimary: boolean } => r.categoryId !== undefined);
      if (rows.length > 0) await tx.insert(clubCategory).values(rows.map((r) => ({ clubId, ...r })));
    }

    // Links: verified when stated by an official/club channel (tier ≤ 5), else candidate.
    await tx.delete(clubLink).where(eq(clubLink.clubId, clubId));
    const linkRows = new Map<string, typeof clubLink.$inferInsert>();
    for (const l of vals<LinkValue>(resolved, "club.link")) {
      const key = normalizeUrl(l.value.url) ?? l.value.url;
      if (linkRows.has(key)) continue;
      linkRows.set(key, {
        clubId,
        kind: l.value.kind,
        url: l.value.url,
        normalizedUrl: key,
        handle: l.value.handle ?? null,
        label: l.value.label ?? null,
        status:
          l.assertionKind === "stated" && l.bestTier <= 5
            ? "verified"
            : l.assertionKind === "editorial"
              ? "verified"
              : "candidate",
        claimId: l.claimId,
        lastObservedAt: new Date(l.observedAt),
      });
    }
    if (linkRows.size > 0) await tx.insert(clubLink).values([...linkRows.values()]);

    // Membership estimates: every eligible claim becomes a row; the resolver's winner is current.
    await tx.delete(membershipEstimate).where(eq(membershipEstimate.clubId, clubId));
    const memberField = getField("club.member_count");
    const winnerId = resolved.get("club.member_count")?.current?.claimId;
    const estimateRows = clubClaims
      .filter((c) => c.fieldKey === memberField.key)
      .map((c) => resolveField<MembershipEstimate>(memberField, [c], now).current)
      .filter((r): r is ResolvedValue<MembershipEstimate> => r !== null)
      .map((r) => ({
        clubId,
        claimId: r.claimId,
        kind: r.value.kind,
        count: r.value.kind === "exact" ? r.value.count : null,
        min: r.value.kind === "range" ? r.value.min : null,
        max: r.value.kind === "range" ? r.value.max : null,
        asOf: r.asOf ? new Date(r.asOf) : new Date(r.observedAt),
        termKey: clubClaims.find((c) => c.id === r.claimId)?.termKey ?? null,
        badge: r.badge,
        isCurrent: r.claimId === winnerId,
      }));
    if (estimateRows.length > 0) await tx.insert(membershipEstimate).values(estimateRows);

    // Recruiting cycles.
    const cycles = await tx
      .select({ id: recruitingCycle.id })
      .from(recruitingCycle)
      .where(eq(recruitingCycle.clubId, clubId));
    for (const { id: cycleId } of cycles) {
      const cycleClaims = claims.filter((c) => c.cycleId === cycleId);
      const r = resolveAll(CYCLE_FIELD_KEYS, cycleClaims, now);
      const cycleFields: Record<string, StoredField> = {};
      for (const [key, v] of r) {
        const stored = toStored(v);
        if (stored) cycleFields[key] = stored;
      }
      const opens = cur<DateValue>(r, "cycle.opens_at");
      const deadline = cur<DateValue>(r, "cycle.deadline");
      await tx
        .update(recruitingCycle)
        .set({
          opensAt: opens ? dateValueStart(opens) : null,
          opensPrecision: opens?.precision ?? null,
          opensValue: opens,
          deadlineAt: deadline ? dateValueEnd(deadline) : null,
          deadlinePrecision: deadline?.precision ?? null,
          deadlineValue: deadline,
          processTypes: vals<string>(r, "cycle.process_type").map((v) => v.value),
          statedStatus: cur<string>(r, "cycle.stated_status"),
          applicationUrl: cur<string>(r, "cycle.application_url"),
          applicants: cur<number>(r, "cycle.applicants"),
          admits: cur<number>(r, "cycle.admits"),
          fields: cycleFields,
        })
        .where(eq(recruitingCycle.id, cycleId));
      await tx.delete(recruitingStage).where(eq(recruitingStage.cycleId, cycleId));
      const stages = cur<StageValue[]>(r, "cycle.stages") ?? [];
      if (stages.length > 0) {
        await tx.insert(recruitingStage).values(
          stages.map((s) => ({
            cycleId,
            ordinal: s.order,
            kind: s.kind,
            label: s.label ?? null,
            startsValue: s.startsAt ?? null,
            endsValue: s.endsAt ?? null,
          })),
        );
      }
    }

    await writeSearchDocument(tx, clubId);
  });
}

/** Rebuild the club's search document from its (already projected) columns and aliases. */
async function writeSearchDocument(tx: Queryable, clubId: string): Promise<void> {
  const [c] = await tx
    .select({
      name: club.canonicalName,
      acronym: club.acronym,
      short: club.shortDescription,
      long: club.longDescription,
    })
    .from(club)
    .where(eq(club.id, clubId));
  if (!c) return;
  const aliases = await tx
    .select({ alias: clubAlias.alias, kind: clubAlias.kind })
    .from(clubAlias)
    .where(eq(clubAlias.clubId, clubId));
  const cats = await tx
    .select({ name: category.name, slug: category.slug })
    .from(clubCategory)
    .innerJoin(category, eq(category.id, clubCategory.categoryId))
    .where(eq(clubCategory.clubId, clubId));
  const tags = await tx
    .select({ value: claim.value })
    .from(claim)
    .where(and(eq(claim.clubId, clubId), eq(claim.fieldKey, "club.tag"), eq(claim.status, "active")));

  const nameText = [c.name, c.acronym ?? "", ...aliases.map((a) => a.alias)].filter(Boolean).join(" ");
  const names = [c.name, ...aliases.map((a) => a.alias)].map(normalizeName).filter(Boolean).join(" | ");
  const acronyms = [
    ...new Set(
      [c.acronym ?? "", ...aliases.filter((a) => a.kind === "acronym" || a.kind === "abbreviation").map((a) => a.alias)]
        .map(normalizeAcronym)
        .filter((a) => a.length >= 2),
    ),
  ];
  const catText = [
    ...cats.map((x) => `${x.name} ${x.slug.replace(/-/g, " ")}`),
    ...tags.map((t) => String(t.value)),
  ].join(" ");

  const document = sql`
    setweight(to_tsvector('simple', ${nameText}), 'A') ||
    setweight(to_tsvector('english', ${nameText}), 'A') ||
    setweight(to_tsvector('english', ${catText}), 'B') ||
    setweight(to_tsvector('english', ${c.short ?? ""}), 'C') ||
    setweight(to_tsvector('english', ${c.long ?? ""}), 'D')`;

  await tx
    .insert(clubSearchDocument)
    .values({ clubId, names, acronyms, document })
    .onConflictDoUpdate({
      target: clubSearchDocument.clubId,
      set: { names, acronyms, document, updatedAt: new Date() },
    });
}

/**
 * Resolve many clubs. Each club resolves in its own transaction so one bad club never
 * aborts the run (CLAUDE.md §11.4).
 */
export async function resolveClubs(
  db: Db,
  options: { clubIds?: readonly string[]; now?: Date; onError?: (clubId: string, error: unknown) => void } = {},
): Promise<ResolveStats> {
  const now = options.now ?? new Date();
  const ids =
    options.clubIds ??
    (await db.select({ id: club.id }).from(club).where(eq(club.recordState, "active"))).map((r) => r.id);
  const stats: ResolveStats = { clubs: 0, failed: 0, errors: [] };
  for (const id of ids) {
    try {
      await resolveClub(db, id, now);
      stats.clubs++;
    } catch (error) {
      stats.failed++;
      stats.errors.push({ clubId: id, error: error instanceof Error ? error.message : String(error) });
      options.onError?.(id, error);
    }
  }
  return stats;
}
