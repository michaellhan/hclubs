import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  FIELDS,
  RESOLVER_VERSION,
  harvardGroupHost,
  leadSentence,
  siteKey,
  assessActivity,
  deriveJoining,
  verifyLink,
  type ActivityStatus,
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
  type PressMentionValue,
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
  sourceSnapshot,
} from "../schema";

/** Extractor name for evidence that a fetched page's title/heading matches the club name. */
export const SITE_IDENTITY_EXTRACTOR = "site-identity";

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

/** Per-evidence details the pure resolver doesn't need but link verification does. */
interface EvidenceExtra {
  tier: number;
  sourceOwnedByClub: boolean;
  sourceType: string;
  sourceUrl: string;
  extractor: string;
  quote: string | null;
  assertion: ClaimInput["assertionKind"];
}

const hostOfUrl = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * ownership-v2 (ADR 0039): an independent page that links this site under the club's own
 * name. Link-graph records such links only when the link text IS the club's name, alias or
 * acronym; Wikipedia's article about the club counts through its "Website" row. Never the
 * club's own pages, never search results. PURE.
 */
export function independentReference(
  ev: readonly Pick<EvidenceExtra, "tier" | "sourceOwnedByClub" | "sourceUrl" | "extractor" | "quote" | "assertion">[],
): string | null {
  const outside = ev.filter((e) => !e.sourceOwnedByClub && e.assertion === "stated");
  const named = outside.filter((e) => e.extractor === "link-graph");
  const harvard = named.find((e) => e.tier <= 7);
  if (harvard) return `${hostOfUrl(harvard.sourceUrl)} links it by the club's name`;
  // Its infobox "Website" row, or an external link titled "<club> official website".
  const wiki = outside.find(
    (e) =>
      /(^|\.)wikipedia\.org$/.test(hostOfUrl(e.sourceUrl)) &&
      (/^(website:|official website)/i.test(e.quote ?? "") ||
        (e.extractor === "link-graph" && /\bofficial\s+website$/i.test(e.quote ?? ""))),
  );
  if (wiki) return "Wikipedia's article on the club gives it as the website";
  // Registrable domain: "lite.harvardgleeclub.org" and "harvardgleeclub.org" are one site.
  const domains = new Set(
    named.map((e) => hostOfUrl(e.sourceUrl).split(".").slice(-2).join(".")).filter((d) => d.includes(".")),
  );
  if (domains.size >= 2) return `${domains.size} other sites link it by the club's name`;
  return null;
}

/**
 * `url` with the host of `working` when the two differ only by "www.". PURE.
 * Any other difference (path, another domain) keeps `url` as claimed.
 */
export function withWorkingHost(url: string, working: string): string {
  try {
    const a = new URL(url);
    const b = new URL(working);
    const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
    if (a.hostname === b.hostname || bare(a.hostname) !== bare(b.hostname)) return url;
    a.hostname = b.hostname;
    a.protocol = b.protocol;
    return a.toString();
  } catch {
    return url;
  }
}

/** A club plus every club merged into it (recursively). Claims stay on their original club. */
export async function clubFamily(db: Queryable, clubId: string): Promise<string[]> {
  const family = [clubId];
  for (let i = 0; i < family.length; i++) {
    const children = await db
      .select({ id: club.id })
      .from(club)
      .where(eq(club.mergedIntoClubId, family[i] as string));
    for (const c of children) if (!family.includes(c.id)) family.push(c.id);
  }
  return family;
}

async function loadClaims(
  db: Queryable,
  where: ReturnType<typeof and>,
  familyIds: readonly string[] = [],
  extras?: Map<string, EvidenceExtra[]>,
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
      srcOwner: source.ownerClubId,
      evExtractor: claimEvidence.extractorName,
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
    if (extras) {
      const list = extras.get(r.id) ?? [];
      list.push({
        tier: r.srcTier,
        // Any channel established as this club's own (website, social, recruiting page).
        sourceOwnedByClub: r.srcOwner !== null && familyIds.includes(r.srcOwner),
        sourceType: r.srcType,
        sourceUrl: r.srcUrl,
        extractor: r.evExtractor,
        quote: r.evQuote,
        assertion: r.assertionKind,
      });
      extras.set(r.id, list);
    }
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

const SOCIAL_LINK_KINDS = new Set(["instagram", "linkedin", "facebook", "x", "youtube", "tiktok"]);

/** "© 2019–2026", "Copyright 2026", "(c) 2026": site-builder footers, not activity. */
export const COPYRIGHT_YEARS = /(?:©|\(c\)|copyright)\s*(?:20[0-9]{2}\s*[-–—]\s*)?20[0-9]{2}/gi;

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
    const familyIds = await clubFamily(tx, clubId);
    const extras = new Map<string, EvidenceExtra[]>();
    const claims = await loadClaims(tx, and(inArray(claim.clubId, familyIds)), familyIds, extras);
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
    // Signals come from live claims only: a rejected claim (a wrong date, a misattributed
    // listing) must not keep a club "active" or count as a source (resolver-v3, ADR 0038).
    const live = claims.filter((c) => c.status === "active");
    const sourceIds = new Set(live.flatMap((c) => c.evidence.map((e) => e.sourceId)));
    const lastObserved = live.flatMap((c) => c.evidence.map((e) => e.observedAt.getTime()));
    const completeness = COMPLETENESS_FIELDS.filter((k) => fields[k] !== undefined).length / COMPLETENESS_FIELDS.length;
    const eligibleClasses = cur<string[]>(resolved, "club.eligible_classes");
    // Every accepted value of a single field, not only the displayed one: the joining
    // derivation weighs a specific class-year rule against a generic one (ADR 0041).
    const everyValue = (key: FieldKey, from: readonly ClaimInput[]) =>
      resolveField({ ...getField(key), cardinality: "multi" }, from, now).values;
    const joining = deriveJoining({
      joinModes: vals(resolved, "club.join_mode"),
      freshmenEligible: everyValue("club.freshmen_eligible", clubClaims),
      eligibleClasses: everyValue("club.eligible_classes", clubClaims),
      cycleEligibleClasses: everyValue(
        "cycle.eligible_classes",
        claims.filter((c) => c.cycleId !== null),
      ),
      dues: resolved.get("club.dues") ?? null,
      tags: vals(resolved, "club.tag"),
    });

    // Official verification freshness: latest observation by a tier ≤ 2 source.
    const officialObs = live.flatMap((c) =>
      c.evidence.filter((e) => e.trustTier >= 1 && e.trustTier <= 2).map((e) => e.observedAt.getTime()),
    );
    const listingObs = live.flatMap((c) =>
      c.evidence.filter((e) => e.trustTier === 1).map((e) => e.observedAt.getTime()),
    );
    const recruitingDates = live
      .filter((c) => c.cycleId !== null && (c.fieldKey === "cycle.deadline" || c.fieldKey === "cycle.opens_at"))
      .map((c) => dateValueEnd(c.value as DateValue).getTime())
      .filter((t) => Number.isFinite(t));
    const websiteSnaps = await tx
      .select({ text: sourceSnapshot.extractedText, fetchedAt: sourceSnapshot.fetchedAt })
      .from(sourceSnapshot)
      .innerJoin(source, eq(source.id, sourceSnapshot.sourceId))
      .where(and(inArray(source.ownerClubId, familyIds), eq(source.sourceType, "club_website")))
      .orderBy(desc(sourceSnapshot.fetchedAt))
      .limit(20);
    const thisYear = now.getUTCFullYear();
    // A footer's "© 2026" is written by the site builder every year; it says nothing about the club.
    const yearsOnSite = websiteSnaps.flatMap((w) =>
      [...(w.text ?? "").replace(COPYRIGHT_YEARS, " ").matchAll(/\b(20[0-9]{2})\b/g)]
        .map((m) => Number(m[1]))
        .filter((y) => y <= thisYear + 1),
    );
    const statedActivity = resolved.get("club.activity_status")?.current;
    const activity = assessActivity(
      {
        stated:
          statedActivity && statedActivity.assertionKind !== "inferred"
            ? {
                status: statedActivity.value as ActivityStatus,
                observedAt: new Date(statedActivity.observedAt),
                tier: statedActivity.bestTier,
              }
            : null,
        officialListingObservedAt: listingObs.length ? new Date(Math.max(...listingObs)) : null,
        latestRecruitingDate: recruitingDates.length ? new Date(Math.max(...recruitingDates)) : null,
        latestYearOnWebsite: yearsOnSite.length ? Math.max(...yearsOnSite) : null,
        websiteFetchedAt: websiteSnaps[0]?.fetchedAt ?? null,
        latestPressMentionAt: latestPressMention(vals<PressMentionValue>(resolved, "club.press_mention")),
      },
      now,
    );

    await tx
      .update(club)
      .set({
        ...(name ? { canonicalName: name } : {}),
        acronym,
        // Our one-line summary (ADR 0029) when there is one; else the sources' short description;
        // else the long description's own first sentence, verbatim, when it describes the club
        // (ADR 0038), so a club with an About text isn't hidden as "sparse".
        shortDescription:
          cur<string>(resolved, "club.summary") ??
          cur<string>(resolved, "club.short_description") ??
          leadSentence(cur<string>(resolved, "club.long_description")),
        longDescription: cur<string>(resolved, "club.long_description"),
        orgType: cur<string>(resolved, "club.org_type"),
        recognitionStatus: cur<string>(resolved, "club.recognition_status") ?? "unknown",
        activityStatus: activity.status,
        activityConfidence: activity.confidence,
        activityReasons: activity.reasons,
        lastVerifiedAt: officialObs.length ? new Date(Math.max(...officialObs)) : null,
        eligibleClasses,
        affiliationScope: cur<string>(resolved, "club.affiliation_scope") ?? "unknown",
        // How general members join: processes stated only for a board, a team or a seat are
        // in `joining.roles`, not here (ADR 0041).
        joinModes: joining.general,
        joining,
        freshmenEligible: joining.firstYears,
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
      // Primary = the category the most independent sources agree on, then the best tier, then
      // stated over inferred: a career center's blanket "pre-professional" listing must not
      // headline a robotics club that SEAS, the CS department and the College directory call
      // academic/technical (ADR 0038).
      const support = (slug: string) =>
        new Set(
          clubClaims
            .filter((c) => c.fieldKey === "club.category" && c.status === "active" && c.value === slug)
            .flatMap((c) => c.evidence.map((e) => e.sourceId)),
        ).size;
      const ranked = [...cats].sort(
        (a, b) =>
          support(b.value) - support(a.value) ||
          a.bestTier - b.bestTier ||
          Number(a.assertionKind === "inferred") - Number(b.assertionKind === "inferred") ||
          a.value.localeCompare(b.value),
      );
      const rows = ranked
        .map((c, i) => ({ categoryId: bySlug.get(c.value), claimId: c.claimId, isPrimary: i === 0 }))
        .filter((r): r is { categoryId: string; claimId: string; isPrimary: boolean } => r.categoryId !== undefined);
      if (rows.length > 0) await tx.insert(clubCategory).values(rows.map((r) => ({ clubId, ...r })));
    }

    // Links: candidate-and-verification (CLAUDE.md §7.1, @hci/core verifyLink).
    await tx.delete(clubLink).where(eq(clubLink.clubId, clubId));
    const linkRows = new Map<string, typeof clubLink.$inferInsert>();
    // Accounts confirmed independently of any website (a Harvard listing or an editor), and
    // the sites whose own pages link to them: the reciprocity signal of ownership-v1.
    const allLinks = vals<LinkValue>(resolved, "club.link");
    const confirmedAccountSites = new Set<string>();
    for (const l of allLinks) {
      if (!SOCIAL_LINK_KINDS.has(l.value.kind)) continue;
      const key = normalizeUrl(l.value.url) ?? l.value.url;
      const claimsForUrl = clubClaims.filter(
        (c) => c.fieldKey === "club.link" && (normalizeUrl((c.value as LinkValue).url) ?? "") === key,
      );
      const independent = claimsForUrl.some((c) =>
        (extras.get(c.id) ?? []).some((e) => e.assertion === "editorial" || (e.tier <= 1 && e.assertion === "stated")),
      );
      if (!independent) continue;
      for (const c of claimsForUrl)
        for (const e of c.evidence) {
          const k = siteKey(e.sourceUrl);
          if (k) confirmedAccountSites.add(k);
        }
    }
    for (const l of allLinks) {
      const key = normalizeUrl(l.value.url) ?? l.value.url;
      if (linkRows.has(key)) continue;
      // All claims for this URL (same link may have been claimed with different labels).
      const sameUrl = clubClaims.filter(
        (c) => c.fieldKey === "club.link" && (normalizeUrl((c.value as LinkValue).url) ?? "") === key,
      );
      const ev = sameUrl.flatMap((c) => extras.get(c.id) ?? []);
      const verification = verifyLink({
        kind: l.value.kind,
        evidence: ev.map((e) => ({
          sourceTier: e.tier,
          fromVerifiedOfficialSite: e.sourceOwnedByClub,
          assertion: e.assertion,
        })),
        nameMatchOnPage: ev.some((e) => e.extractor === SITE_IDENTITY_EXTRACTOR),
        reciprocal: l.value.kind === "website" && confirmedAccountSites.has(siteKey(l.value.url) ?? "\u0000"),
        harvardHostedGroupSite: l.value.kind === "website" && harvardGroupHost(l.value.url),
        independentReference: l.value.kind === "website" ? independentReference(ev) : null,
      });
      linkRows.set(key, {
        clubId,
        kind: l.value.kind,
        url: l.value.url,
        normalizedUrl: key,
        handle: l.value.handle ?? null,
        label: l.value.label ?? null,
        status: verification.status,
        confidence: verification.confidence,
        discoveredVia: [...new Set([...ev].sort((a, b) => a.tier - b.tier).map((e) => e.sourceType))],
        signals: verification.signals,
        claimId: l.claimId,
        lastObservedAt: new Date(l.observedAt),
      });
    }
    // A site may answer on only one of "example.org" / "www.example.org", which share one
    // normalized identity. Show the host that last fetched successfully (launch audit:
    // theharvardadvocate.com stopped resolving; www.theharvardadvocate.com works).
    const siteKeys = [...linkRows.values()].filter((r) => r.kind === "website").map((r) => r.normalizedUrl);
    if (siteKeys.length) {
      const fetched = await tx
        .select({ key: source.normalizedUrl, finalUrl: sourceSnapshot.finalUrl })
        .from(sourceSnapshot)
        .innerJoin(source, eq(source.id, sourceSnapshot.sourceId))
        .where(and(inArray(source.normalizedUrl, siteKeys), eq(sourceSnapshot.httpStatus, 200)))
        .orderBy(desc(sourceSnapshot.fetchedAt));
      for (const row of linkRows.values()) {
        const last = fetched.find((f) => f.key === row.normalizedUrl);
        if (last) row.url = withWorkingHost(row.url, last.finalUrl);
      }
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
    if (estimateRows.length > 0) {
      // After a merge, the absorbed club may still hold rows for these claims (the resolver
      // follows the merge chain, so the survivor now owns them): the claim is the key.
      await tx.delete(membershipEstimate).where(
        inArray(
          membershipEstimate.claimId,
          estimateRows.map((r) => r.claimId),
        ),
      );
      await tx.insert(membershipEstimate).values(estimateRows);
    }

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
          eligibleClasses: cur<string[]>(r, "cycle.eligible_classes"),
          lastVerifiedAt: (() => {
            const t = cycleClaims.flatMap((c) =>
              c.evidence.filter((e) => e.trustTier <= 5).map((e) => e.observedAt.getTime()),
            );
            return t.length ? new Date(Math.max(...t)) : null;
          })(),
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

function latestPressMention(values: ResolvedValue<PressMentionValue>[]): Date | null {
  const times = values.map((v) => Date.parse(`${v.value.publishedOn}T12:00:00Z`)).filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * What a field would show with one more claim (ADR 0035): the displayed value now, and with
 * `extra` added. Read-only; lets a reviewer see whether accepting a community value would
 * replace a sourced one before anything is written.
 */
export async function previewFieldResolution(
  db: Queryable,
  input: { clubId: string; fieldKey: FieldKey; cycleId: string | null; extra: ClaimInput; now: Date },
): Promise<{ before: ResolvedField; after: ResolvedField }> {
  const family = await clubFamily(db, input.clubId);
  const claims = (
    await loadClaims(db, and(inArray(claim.clubId, family), eq(claim.fieldKey, input.fieldKey)), family)
  ).filter((c) => c.cycleId === input.cycleId);
  const field = getField(input.fieldKey);
  return {
    before: resolveField(field, claims, input.now),
    after: resolveField(field, [...claims, input.extra], input.now),
  };
}
