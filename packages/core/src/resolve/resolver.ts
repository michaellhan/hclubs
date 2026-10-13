import { combineConfidence } from "../confidence";
import type { AssertionKind, Badge, ExtractionMethod, SourceType } from "../enums";
import { SOURCE_TYPE_TIER } from "../enums";
import type { FieldDefinition } from "../fields/registry";
import { STALE_AFTER_DAYS } from "../fields/registry";
import { stableStringify } from "../ids";
import { normalizeName } from "../normalize/names";
import { dedupeNearDuplicates } from "./near-duplicates";

/**
 * Deterministic claim resolver. CLAUDE.md §7.3.
 * Pure: (claims + evidence + now) -> displayed value(s) with provenance metadata.
 * The database layer loads claims, calls this, and writes projections.
 */
export const RESOLVER_VERSION = "resolver-v17";

export interface EvidenceInput {
  sourceId: string;
  sourceType: SourceType;
  trustTier: number;
  sourceUrl: string;
  sourceTitle: string | null;
  isFixture: boolean;
  extractionMethod: ExtractionMethod;
  isDirect: boolean;
  confidence: number;
  observedAt: Date;
  quote: string | null;
}

export interface ClaimInput {
  id: string;
  /**
   * The club the claim was made about. After a merge it stays the absorbed club's id
   * (§12 merge chain), which lets `survivorFirst` fields prefer the survivor's own claims.
   * Optional: absent means the club being resolved.
   */
  subjectId?: string;
  fieldKey: string;
  value: unknown;
  normalizedValue: unknown;
  assertionKind: AssertionKind;
  status: "active" | "superseded" | "retracted" | "rejected";
  termKey: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  asOfDate: Date | null;
  evidence: readonly EvidenceInput[];
}

export interface SourceRef {
  sourceId: string;
  sourceType: SourceType;
  url: string;
  title: string | null;
  observedAt: string; // ISO
  isFixture: boolean;
  quote: string | null;
}

export interface ResolvedValue<T = unknown> {
  value: T;
  claimId: string;
  badge: Badge;
  confidence: number;
  assertionKind: AssertionKind;
  bestTier: number;
  observedAt: string; // ISO, most recent observation
  asOf: string | null; // ISO date the source says the value applied, if stated
  stale: boolean;
  sources: SourceRef[];
}

export interface ResolvedField<T = unknown> {
  fieldKey: string;
  /** Winning value for single fields; null when unknown. */
  current: ResolvedValue<T> | null;
  /** All accepted values for multi fields (empty for single fields). */
  values: ResolvedValue<T>[];
  /** Competing values of comparable standing that disagree with `current`. */
  alternatives: ResolvedValue<T>[];
  conflict: boolean;
}

/**
 * Does a competing value say something different? Without a registry `conflictKey`, any
 * distinct value does. With one, values with the same key agree (two wordings of "no dues"),
 * and a value whose key is null says nothing to disagree with (resolver-v13).
 */
function disagrees(field: FieldDefinition, winner: ClaimInput, other: ClaimInput): boolean {
  if (!field.conflictKey) return true;
  const a = field.conflictKey(winner.value);
  const b = field.conflictKey(other.value);
  return a !== null && b !== null && a !== b;
}

interface Scored {
  claim: ClaimInput;
  bestTier: number;
  lastObserved: number;
  effectiveDate: number;
  /**
   * For recency-first fields: the stated date (as-of / valid-from) when there is one;
   * otherwise the observation time rounded down to the field's staleness window. When a
   * page was fetched says nothing about when its fact applied, so a re-crawled Wikipedia
   * article must not outrank the club's own page fetched a few days earlier (ADR 0033).
   */
  recencyKey: number;
  confidence: number;
  valueKey: string;
}

const DAY_MS = 86_400_000;

function score(claim: ClaimInput, windowMs: number): Scored | null {
  if (claim.evidence.length === 0) return null;
  const bestTier = Math.min(
    ...claim.evidence.map((e) =>
      claim.assertionKind === "editorial" ? 0 : (e.trustTier ?? SOURCE_TYPE_TIER[e.sourceType]),
    ),
  );
  const lastObserved = Math.max(...claim.evidence.map((e) => e.observedAt.getTime()));
  // Distinct sources corroborate; repeated observations of one source do not.
  const bySource = new Map<string, number>();
  for (const e of claim.evidence) bySource.set(e.sourceId, Math.max(bySource.get(e.sourceId) ?? 0, e.confidence));
  const confidence = combineConfidence([...bySource.values()]);
  const stated = (claim.asOfDate ?? claim.validFrom)?.getTime();
  const effectiveDate = stated ?? lastObserved;
  const recencyKey = stated ?? Math.floor(lastObserved / windowMs) * windowMs;
  return {
    claim,
    bestTier,
    lastObserved,
    effectiveDate,
    recencyKey,
    confidence,
    valueKey: stableStringify(claim.normalizedValue),
  };
}

function eligible(field: FieldDefinition, claim: ClaimInput, now: Date): boolean {
  if (claim.status !== "active") return false;
  if (claim.fieldKey !== field.key) return false;
  if (claim.assertionKind === "inferred" && !field.allowInferred) return false;
  if (claim.validUntil && claim.validUntil.getTime() < now.getTime()) return false;
  if (claim.validFrom && claim.validFrom.getTime() > now.getTime()) return false;
  return true;
}

/** Tiers 2–5: the club's own site, socials, recruiting material and publications (§7.1). */
const ownChannel = (tier: number) => tier >= 2 && tier <= 5;

function compare(field: FieldDefinition, a: Scored, b: Scored): number {
  // Editorial always first.
  const ea = a.claim.assertionKind === "editorial" ? 0 : 1;
  const eb = b.claim.assertionKind === "editorial" ? 0 : 1;
  if (ea !== eb) return ea - eb;
  // Stated beats inferred at equal standing.
  const ia = a.claim.assertionKind === "inferred" ? 1 : 0;
  const ib = b.claim.assertionKind === "inferred" ? 1 : 0;
  if (field.resolution === "recency_then_priority") {
    if (a.recencyKey !== b.recencyKey) return b.recencyKey - a.recencyKey;
    if (field.ownSourceFirst) {
      const oa = ownChannel(a.bestTier) ? 0 : 1;
      const ob = ownChannel(b.bestTier) ? 0 : 1;
      if (oa !== ob) return oa - ob;
    }
    if (a.bestTier !== b.bestTier) return a.bestTier - b.bestTier;
    if (a.effectiveDate !== b.effectiveDate) return b.effectiveDate - a.effectiveDate;
  } else {
    if (a.bestTier !== b.bestTier) return a.bestTier - b.bestTier;
    if (ia !== ib) return ia - ib;
    if (a.effectiveDate !== b.effectiveDate) return b.effectiveDate - a.effectiveDate;
  }
  if (ia !== ib) return ia - ib;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.claim.id < b.claim.id ? -1 : a.claim.id > b.claim.id ? 1 : 0;
}

export function badgeFor(
  s: Pick<Scored, "bestTier" | "lastObserved"> & { assertionKind: AssertionKind },
  field: FieldDefinition,
  now: Date,
): {
  badge: Badge;
  stale: boolean;
} {
  const stale = now.getTime() - s.lastObserved > STALE_AFTER_DAYS[field.volatility] * DAY_MS;
  switch (s.assertionKind) {
    case "computed":
      return { badge: "computed", stale };
    case "inferred":
      return { badge: "estimate", stale };
    case "user_reported":
      return { badge: "community", stale };
    case "editorial":
      return { badge: "verified", stale };
    case "stated":
      if (s.bestTier === 9) return { badge: "community", stale };
      if (s.bestTier <= 5 && !stale) return { badge: "verified", stale };
      return { badge: "reported", stale };
  }
}

function toResolved<T>(s: Scored, field: FieldDefinition, now: Date): ResolvedValue<T> {
  const { badge, stale } = badgeFor({ ...s, assertionKind: s.claim.assertionKind }, field, now);
  // One quote per source: an editor-read one (chosen on purpose, the whole sentence) before
  // an extractor's newer re-observation of the same page (resolver-v16: the Band's "no need to
  // sweat our auditions — anyone who wants to join the Band can join" lost to a shortened LLM span).
  const sources = [...s.claim.evidence]
    .sort(
      (a, b) =>
        a.trustTier - b.trustTier ||
        Number(b.extractionMethod === "manual") - Number(a.extractionMethod === "manual") ||
        b.observedAt.getTime() - a.observedAt.getTime(),
    )
    .filter((e, i, arr) => arr.findIndex((x) => x.sourceId === e.sourceId) === i)
    .map<SourceRef>((e) => ({
      sourceId: e.sourceId,
      sourceType: e.sourceType,
      url: e.sourceUrl,
      title: e.sourceTitle,
      observedAt: e.observedAt.toISOString(),
      isFixture: e.isFixture,
      quote: e.quote,
    }));
  return {
    value: s.claim.value as T,
    claimId: s.claim.id,
    badge,
    confidence: s.confidence,
    assertionKind: s.claim.assertionKind,
    bestTier: s.bestTier,
    observedAt: new Date(s.lastObserved).toISOString(),
    asOf: s.claim.asOfDate ? s.claim.asOfDate.toISOString() : null,
    stale,
    sources,
  };
}

/** Claims made about `subjectId` itself (not about a club merged into it). */
const isOwn = (c: ClaimInput, subjectId: string) => c.subjectId === undefined || c.subjectId === subjectId;

/**
 * `subjectId` is the club being resolved (the merge survivor). For `survivorFirst` fields
 * its own claims are the only candidates when it has any (resolver-v9).
 */
export function resolveField<T = unknown>(
  field: FieldDefinition,
  claims: readonly ClaimInput[],
  now: Date,
  subjectId?: string,
): ResolvedField<T> {
  const windowMs = STALE_AFTER_DAYS[field.volatility] * DAY_MS;
  let pool = claims.filter((c) => eligible(field, c, now));
  if (field.survivorFirst && subjectId !== undefined && pool.some((c) => isOwn(c, subjectId))) {
    pool = pool.filter((c) => isOwn(c, subjectId));
  }
  const scored = pool
    .map((c) => score(c, windowMs))
    .filter((s): s is Scored => s !== null)
    // Too old to use at all (registry `maxAgeDays`, resolver-v10): unknown, not a stale value.
    .filter((s) => field.maxAgeDays === undefined || now.getTime() - s.lastObserved <= field.maxAgeDays * DAY_MS)
    .sort((a, b) => compare(field, a, b));

  if (field.cardinality === "multi") {
    const seen = new Set<string>();
    const values: ResolvedValue<T>[] = [];
    for (const s of scored) {
      if (seen.has(s.valueKey)) continue;
      seen.add(s.valueKey);
      values.push(toResolved<T>(s, field, now));
    }
    // Activities are written freely, so the same thing arrives in several wordings.
    const shown = field.key === "club.activity" ? dedupeNearDuplicates(values.map((v) => String(v.value))) : null;
    return {
      fieldKey: field.key,
      current: null,
      values: shown ? shown.map((i) => values[i] as ResolvedValue<T>) : values,
      alternatives: [],
      conflict: false,
    };
  }

  const [winner, ...rest] = scored;
  if (!winner) return { fieldKey: field.key, current: null, values: [], alternatives: [], conflict: false };

  // A competing value is a conflict if it is of comparable standing: within one trust tier,
  // and (for recency-based fields) observed within the same staleness window.
  const seen = new Set([winner.valueKey]);
  const alternatives: ResolvedValue<T>[] = [];
  for (const s of rest) {
    if (seen.has(s.valueKey)) continue;
    seen.add(s.valueKey);
    const comparableTier = s.bestTier <= winner.bestTier + 1;
    const comparableTime = Math.abs(winner.effectiveDate - s.effectiveDate) <= windowMs;
    const notOverridden = winner.claim.assertionKind !== "editorial";
    if (comparableTier && comparableTime && notOverridden && disagrees(field, winner.claim, s.claim))
      alternatives.push(toResolved<T>(s, field, now));
  }
  return {
    fieldKey: field.key,
    current: toResolved<T>(winner, field, now),
    values: [],
    alternatives,
    conflict: field.flagsConflicts && alternatives.length > 0,
  };
}

/**
 * Names of clubs merged into `subjectId` that the profile does not display: kept as
 * alternate names so a search for the absorbed listing's name still finds the club
 * (resolver-v9, ADR 0019 amendment). Deduped by normalized name; the displayed name and
 * the survivor's own names are left out. PURE.
 */
export function absorbedNameAliases(
  field: FieldDefinition,
  claims: readonly ClaimInput[],
  now: Date,
  subjectId: string,
): ResolvedValue<string>[] {
  const normalize = normalizeName;
  const shown = resolveField<string>(field, claims, now, subjectId).current;
  const exclude = new Set<string>();
  if (shown) exclude.add(normalize(shown.value));
  const absorbed = claims.filter((c) => !isOwn(c, subjectId));
  const all = resolveField<string>({ ...field, cardinality: "multi", survivorFirst: false }, absorbed, now).values;
  const out: ResolvedValue<string>[] = [];
  for (const v of all) {
    const key = normalize(v.value);
    if (!key || exclude.has(key)) continue;
    exclude.add(key);
    out.push(v);
  }
  return out;
}
