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
export const MATCHER_VERSION = "matcher-v3";

export interface OrgIdentity {
  names: readonly string[]; // canonical name + aliases (raw; normalized internally)
  acronyms?: readonly string[];
  urls?: readonly string[]; // official websites / social accounts
  externalIds?: readonly { system: string; id: string }[];
  /** Free-text descriptions, used only as a medium signal alongside an acronym/name signal. */
  descriptions?: readonly string[];
}

export interface KnownOrg extends OrgIdentity {
  clubId: string;
}

/**
 * definite  — auto-matched with high confidence
 * probable  — likely duplicate, needs review
 * ambiguous — several plausible matches, needs review
 * new       — new canonical entity
 */
export type MatchDecision = "definite" | "probable" | "ambiguous" | "new";

export interface MatchSignal {
  kind:
    | "external_id"
    | "external_id_conflict"
    | "division_conflict"
    | "site"
    | "site_conflict"
    | "social"
    | "exact_name"
    | "acronym"
    | "initials"
    | "description"
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
  /** Human-readable reasoning, persisted for review. */
  explanation: string;
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
  descTokens: Set<string>;
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "our",
  "are",
  "that",
  "this",
  "from",
  "harvard",
  "students",
  "student",
  "undergraduate",
  "college",
  "club",
  "organization",
  "we",
  "of",
  "to",
  "in",
  "a",
  "an",
  "is",
  "on",
  "by",
]);
function descTokens(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of normalizeName(t).split(" ")) if (w.length > 3 && !STOP.has(w)) out.add(w);
  return out;
}

/** "Harvard Computer Society (HCS)" -> name "Harvard Computer Society", acronym "HCS". */
export function splitParentheticalAcronym(name: string): { base: string; acronym: string | null } {
  const m = /^(.*?)\s*\(([^()]{2,15})\)\s*$/.exec(name.trim());
  if (!m?.[1] || !m[2]) return { base: name, acronym: null };
  const inner = m[2].trim();
  // Short forms: no spaces, starts with a letter, at least two capitals ("HCS", "WiCS", "HackHarvard").
  const isShortForm = /^[A-Za-z][A-Za-z0-9&.-]{1,14}$/.test(inner) && (inner.match(/[A-Z]/g) ?? []).length >= 2;
  return { base: m[1].trim(), acronym: isShortForm ? inner : null };
}

function prepare(o: OrgIdentity): PreparedIdentity {
  const expanded: string[] = [];
  const parenAcronyms: string[] = [];
  for (const n of o.names) {
    expanded.push(n);
    const { base, acronym } = splitParentheticalAcronym(n);
    if (base !== n) expanded.push(base);
    if (acronym) parenAcronyms.push(acronym);
  }
  const names = new Set(expanded.map(normalizeName).filter(Boolean));
  const blocks = new Set(expanded.map((n) => blockingKey(n.replace(/\s*\([^)]*\)\s*/g, " "))).filter(Boolean));
  const acronyms = new Set(
    [...(o.acronyms ?? []), ...parenAcronyms].map(normalizeAcronym).filter((a) => a.length >= 2),
  );
  const initials = new Set(expanded.map(initialsOf).filter((a) => a.length >= 2));
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
  return {
    names,
    blocks,
    acronyms,
    initials,
    sites,
    socials,
    externalIds,
    rawNames: expanded,
    descTokens: descTokens(o.descriptions ?? []),
  };
}

/** Name without parenthetical qualifiers ("Basketball (Men's Club Sport)" → "Basketball"). */
function coreName(n: string): string {
  return n.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}
const GENDER = /\b(men|mens|men's|women|womens|women's)\b/i;
function genderOf(n: string): "m" | "w" | null {
  const m = GENDER.exec(n)?.[1]?.toLowerCase();
  return m ? (m.startsWith("w") ? "w" : "m") : null;
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

  // Medium: descriptions overlap substantially AND there is already an acronym/initials signal.
  if (
    c.descTokens.size >= 4 &&
    k.descTokens.size >= 4 &&
    signals.some((s) => s.kind === "acronym" || s.kind === "initials")
  ) {
    const shared = [...c.descTokens].filter((t) => k.descTokens.has(t)).length;
    const jaccard = shared / (c.descTokens.size + k.descTokens.size - shared);
    if (jaccard >= 0.2)
      signals.push({ kind: "description", detail: `description overlap ${jaccard.toFixed(2)}`, weight: 0.25 });
  }

  // Men's vs women's teams are different organizations.
  const gc = c.rawNames.map(genderOf).find(Boolean) ?? null;
  const gk = k.rawNames.map(genderOf).find(Boolean) ?? null;
  if (gc && gk && gc !== gk) {
    signals.push({ kind: "division_conflict", detail: "different gender divisions", weight: -1 });
    conflicting = true;
  }

  if (sharedNames.length === 0) {
    // Fuzzy similarity on the distinctive part of core names (qualifiers and generic words
    // like "Harvard Undergraduate … Club" stripped): otherwise the shared boilerplate made
    // "Harvard Undergraduate Poker Club" look like "Harvard Undergraduate Robotics Club".
    // Names made only of generic words ("Harvard College") carry no fuzzy signal.
    let best = 0;
    for (const a of c.rawNames)
      for (const b of k.rawNames) {
        const ka = blockingKey(coreName(a));
        const kb = blockingKey(coreName(b));
        if (!ka || !kb) continue;
        best = Math.max(best, trigramSimilarity(ka, kb));
        // A partial name ("Harvard Ballroom" / "Harvard Ballroom Dance Team"): all of one's
        // distinctive words appear in the other.
        const ta = ka.split(" ");
        const tb = new Set(kb.split(" "));
        const [short, long] = ta.length <= tb.size ? [ta, tb] : [kb.split(" "), new Set(ta)];
        if (short.every((t) => long.has(t))) best = Math.max(best, FUZZY_REVIEW_THRESHOLD);
      }
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
  if (!best) return { decision: "new", clubId: null, score: 0, ...base, explanation: "no plausible candidates" };

  const describe = (m: MatchCandidate) => m.signals.map((s) => `${s.kind}(${s.detail})`).join(", ");
  const hasExactName = best.signals.some((s) => s.kind === "exact_name");
  const softConflict = best.signals.some((s) => s.kind === "site_conflict");
  const plausible = (m: MatchCandidate) => m.strong || m.signals.some((s) => s.kind === "exact_name") || m.score >= 0.4;
  // Another candidate with a similarly strong claim makes the match ambiguous.
  const rivals = top.slice(1).filter((m) => plausible(m) && m.score >= best.score - 0.05);

  if (rivals.length > 0 && plausible(best)) {
    return {
      decision: "ambiguous",
      clubId: best.clubId,
      score: best.score,
      ...base,
      explanation: `ambiguous: ${1 + rivals.length} candidates score within 0.05 (${[best, ...rivals].map(describe).join(" | ")})`,
    };
  }
  if (best.strong || (hasExactName && !softConflict)) {
    return {
      decision: "definite",
      clubId: best.clubId,
      score: best.score,
      ...base,
      explanation: `auto-matched: ${describe(best)}`,
    };
  }
  return {
    decision: "probable",
    clubId: best.clubId,
    score: best.score,
    ...base,
    explanation: `likely duplicate, needs review: ${describe(best)}${softConflict ? " (official sites differ)" : ""}`,
  };
}
