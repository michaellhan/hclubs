import { blockingKey, initialsOf, normalizeAcronym, normalizeName, trigramSimilarity } from "../normalize/names";
import { socialIdentityKey } from "../normalize/social";
import { siteKey } from "../normalize/urls";

/**
 * Conservative entity matching. CLAUDE.md §12.
 *
 *   definite  — a strong identifier matches (external directory id, official site, social
 *               handle) or the full normalized name/alias matches exactly, AND no strong
 *               identifier contradicts it.
 *   probable  — plausible but not proven (acronym-only, fuzzy name, conflicting ids).
 *               Never auto-merged: callers create a merge candidate for human review.
 *   new       — nothing plausible.
 */
export const MATCHER_VERSION = "matcher-v1";

export interface OrgIdentity {
  names: readonly string[]; // canonical name + aliases (raw; normalized internally)
  acronyms?: readonly string[];
  urls?: readonly string[]; // official websites / social accounts
  externalIds?: readonly { system: string; id: string }[];
}

export interface KnownOrg extends OrgIdentity {
  clubId: string;
}

export type MatchDecision = "definite" | "probable" | "new";

export interface MatchSignal {
  kind:
    | "external_id"
    | "external_id_conflict"
    | "site"
    | "site_conflict"
    | "social"
    | "exact_name"
    | "acronym"
    | "initials"
    | "fuzzy_name";
  detail: string;
  weight: number;
}

export interface MatchCandidate {
  clubId: string;
  score: number;
  signals: MatchSignal[];
  strong: boolean;
  conflicting: boolean;
}

export interface MatchResult {
  decision: MatchDecision;
  clubId: string | null;
  score: number;
  candidates: MatchCandidate[]; // top candidates, best first
  matcherVersion: string;
}

export const FUZZY_REVIEW_THRESHOLD = 0.55;

interface PreparedIdentity {
  names: Set<string>;
  blocks: Set<string>;
  acronyms: Set<string>;
  initials: Set<string>;
  sites: Set<string>;
  socials: Set<string>;
  externalIds: Map<string, string>;
  rawNames: readonly string[];
}

function prepare(o: OrgIdentity): PreparedIdentity {
  const names = new Set(o.names.map(normalizeName).filter(Boolean));
  const blocks = new Set(o.names.map(blockingKey).filter(Boolean));
  const acronyms = new Set((o.acronyms ?? []).map(normalizeAcronym).filter((a) => a.length >= 2));
  const initials = new Set(o.names.map(initialsOf).filter((a) => a.length >= 2));
  const sites = new Set<string>();
  const socials = new Set<string>();
  for (const url of o.urls ?? []) {
    const social = socialIdentityKey(url);
    if (social) socials.add(social);
    else {
      const site = siteKey(url);
      if (site) sites.add(site);
    }
  }
  const externalIds = new Map((o.externalIds ?? []).map((e) => [e.system, e.id]));
  return { names, blocks, acronyms, initials, sites, socials, externalIds, rawNames: o.names };
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => b.has(x));
}

function evaluate(c: PreparedIdentity, k: PreparedIdentity, clubId: string): MatchCandidate {
  const signals: MatchSignal[] = [];
  let strong = false;
  let conflicting = false;

  for (const [system, id] of c.externalIds) {
    const other = k.externalIds.get(system);
    if (other === undefined) continue;
    if (other === id) {
      signals.push({ kind: "external_id", detail: `${system}:${id}`, weight: 1 });
      strong = true;
    } else {
      signals.push({ kind: "external_id_conflict", detail: `${system}: ${id} ≠ ${other}`, weight: -1 });
      conflicting = true;
    }
  }

  const sharedSites = intersect(c.sites, k.sites);
  if (sharedSites.length > 0) {
    signals.push({ kind: "site", detail: sharedSites.join(", "), weight: 0.9 });
    strong = true;
  } else if (c.sites.size > 0 && k.sites.size > 0) {
    // Both have official sites and none overlap: weak contradiction (clubs change domains).
    signals.push({ kind: "site_conflict", detail: `${[...c.sites][0]} vs ${[...k.sites][0]}`, weight: -0.3 });
  }

  const sharedSocial = intersect(c.socials, k.socials);
  if (sharedSocial.length > 0) {
    signals.push({ kind: "social", detail: sharedSocial.join(", "), weight: 0.9 });
    strong = true;
  }

  const sharedNames = intersect(c.names, k.names);
  if (sharedNames.length > 0) {
    signals.push({ kind: "exact_name", detail: sharedNames[0] ?? "", weight: 0.85 });
  }

  const sharedAcr = intersect(c.acronyms, k.acronyms);
  if (sharedAcr.length > 0) {
    signals.push({ kind: "acronym", detail: sharedAcr.join(", "), weight: 0.4 });
  } else {
    const initialMatch = intersect(c.acronyms, k.initials).length > 0 || intersect(c.initials, k.acronyms).length > 0;
    if (initialMatch) signals.push({ kind: "initials", detail: "acronym matches initials", weight: 0.25 });
  }

  if (sharedNames.length === 0) {
    let best = 0;
    for (const a of c.rawNames) for (const b of k.rawNames) best = Math.max(best, trigramSimilarity(a, b));
    const sameBlock = intersect(c.blocks, k.blocks).length > 0;
    if (best >= FUZZY_REVIEW_THRESHOLD || sameBlock) {
      signals.push({
        kind: "fuzzy_name",
        detail: `similarity ${best.toFixed(2)}${sameBlock ? ", same core name" : ""}`,
        weight: Math.max(best, sameBlock ? 0.6 : 0) * 0.7,
      });
    }
  }

  const score = Math.max(
    0,
    Math.min(
      1,
      signals.reduce((acc, s) => acc + s.weight, 0),
    ),
  );
  return { clubId, score: Math.round(score * 1000) / 1000, signals, strong, conflicting };
}

export function matchOrganization(candidate: OrgIdentity, known: readonly KnownOrg[]): MatchResult {
  const c = prepare(candidate);
  const evaluated = known
    .map((k) => evaluate(c, prepare(k), k.clubId))
    // Different ids in the same authoritative directory mean different organizations:
    // such candidates are ruled out, not sent to review.
    .filter((m) => !m.conflicting)
    .filter((m) => m.signals.some((s) => s.weight > 0) && m.score > 0)
    .sort((a, b) => b.score - a.score || (a.clubId < b.clubId ? -1 : 1));

  const top = evaluated.slice(0, 5);
  const best = top[0];
  const base = { candidates: top, matcherVersion: MATCHER_VERSION };
  if (!best) return { decision: "new", clubId: null, score: 0, ...base };

  const hasExactName = best.signals.some((s) => s.kind === "exact_name");
  const softConflict = best.signals.some((s) => s.kind === "site_conflict");
  // Another candidate with an equally strong claim makes the match ambiguous.
  const rival = top
    .slice(1)
    .find((m) => (m.strong || m.signals.some((s) => s.kind === "exact_name")) && m.score >= best.score - 0.05);

  if (!rival && (best.strong || (hasExactName && !softConflict))) {
    return { decision: "definite", clubId: best.clubId, score: best.score, ...base };
  }
  return { decision: "probable", clubId: best.clubId, score: best.score, ...base };
}
