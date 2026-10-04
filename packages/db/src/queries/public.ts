import { emailPublishProblem, withoutTrackingParams, type BasisSource, type Joining, type JoiningBasis } from "@hci/core";
import type { StoredField } from "../resolve/project";
import type { ClubProfile, SourceDisplay } from "./types";

/**
 * What a published club profile may contain (CLAUDE.md §21; launch audit 2026-10-01). The
 * resolver keeps evidence quotes and every observed address for review; the static site
 * gets a copy without them:
 * - no evidence quotes: they are verbatim page text and can name officers or members;
 * - no personal, placeholder or malformed email addresses, as links or inside text;
 * - search-API source URLs become the equivalent public search page;
 * - no competing ("alternative") text values: they hold text the resolver passed over
 *   (other pages' descriptions, sometimes naming people). Numbers, ranges and yes/no
 *   values (`PUBLIC_ALTERNATIVES`) keep theirs, so a profile can say "sources differ"
 *   and show what each says (ADR 0036). PURE.
 */

/** Fields whose competing values are structured (no free text) and safe to publish. */
export const PUBLIC_ALTERNATIVES: ReadonlySet<string> = new Set([
  "club.member_count",
  "club.hours_per_week",
  "club.freshmen_eligible",
  "club.eligible_classes",
  "club.recruiting_seasons",
  "club.org_type",
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** A search API request as the public results page a person can open; tracking ids dropped. */
export function publicSourceUrl(url: string): { url: string; title: string | null } {
  try {
    const u = new URL(url);
    if (u.hostname === "api.search.brave.com") {
      const q = u.searchParams.get("q") ?? "";
      return { url: `https://search.brave.com/search?q=${encodeURIComponent(q)}`, title: `Brave Search: ${q}` };
    }
  } catch {
    // not a URL; leave it
  }
  return { url: withoutTrackingParams(url), title: null };
}

/**
 * A news title that is only a person's name, on an article addressed by that name ("Awnit
 * Marta | The Harvard Crimson" at …/awnit-marta, a student profile), reads as naming a member
 * on a club page: show the publication instead. PURE.
 */
export function personTitleless(title: string | null, url: string): string | null {
  if (!title) return title;
  const [head = "", ...rest] = title.split(/\s+[|–—]\s+/);
  if (!/^[A-Z][a-z]+(?:[- ][A-Z][a-z]+){1,2}$/.test(head.trim())) return title;
  // Only an article addressed by that same name (thecrimson.com/article/…/awnit-marta).
  const slug = head.trim().toLowerCase().replace(/\s+/g, "-");
  let last = "";
  try {
    last = new URL(url).pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  } catch {
    return title;
  }
  if (last !== slug) return title;
  if (/\b(Harvard|Club|Society|Association|Group|Team|Review|Company|Ensemble|Project)\b/.test(head)) return title;
  const pub = rest.join(" ").trim();
  return pub ? `${pub} article` : "Article";
}

function redactText(text: string, names: readonly string[]): string {
  return text.replace(EMAIL, (a) => (emailPublishProblem(a, names) ? "[email removed]" : a));
}

/** Deep copy with every string's personal emails removed and every `quote` dropped. */
function scrub(value: unknown, names: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, names);
  if (Array.isArray(value)) return value.map((v) => scrub(v, names));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "quote") out[k] = null;
      else if (k === "url" && typeof v === "string") out[k] = redactText(publicSourceUrl(v).url, names);
      else out[k] = scrub(v, names);
    }
    return out;
  }
  return value;
}

/**
 * A resolved value as published: an explicit allowlist, so a field added to the resolver
 * later stays internal until it is listed here (ADR 0039). Confidence and the best source
 * tier are internal scoring and are withheld (0); source ids are database keys.
 */
/** Value keys that are extraction internals: the matched source text is a quote, the confidence a score. */
const INTERNAL_VALUE_KEYS = new Set(["sourceText", "parseConfidence"]);
function withoutInternals(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutInternals);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).filter(([k]) => !INTERNAL_VALUE_KEYS.has(k)).map(([k, x]) => [k, withoutInternals(x)]),
    );
  }
  return v;
}

function publicValue<T extends StoredValue>(v: T): T {
  return {
    value: withoutInternals(v.value),
    claimId: v.claimId,
    badge: v.badge,
    confidence: 0,
    assertionKind: v.assertionKind,
    bestTier: 0,
    observedAt: v.observedAt,
    asOf: v.asOf,
    stale: v.stale,
    sources: v.sources.map((s) => ({
      sourceId: "",
      sourceType: s.sourceType,
      url: s.url,
      title: s.title,
      observedAt: s.observedAt,
      isFixture: s.isFixture,
      quote: null,
    })),
  } as T;
}
type StoredValue = Extract<StoredField, { kind: "single" }>["current"];

export function publicProfile(profile: ClubProfile): ClubProfile {
  const names = [profile.name, ...(profile.acronym ? [profile.acronym] : []), ...profile.aliases.map((a) => a.alias)];
  const links = profile.links
    .filter((l) => {
      if (l.kind !== "email") return true;
      return !emailPublishProblem(l.url.replace(/^mailto:/i, ""), names);
    })
    // A link's verification score is internal, like a value's confidence (ADR 0040).
    .map((l) => ({ ...l, confidence: 0 }));
  const sources: SourceDisplay[] = profile.sources.map((s) => {
    const p = publicSourceUrl(s.url);
    return { ...s, url: p.url, title: p.title ?? personTitleless(s.title, s.url) };
  });
  const fields = publicFields(profile.fields);
  // Every place a resolved value appears goes through the allowlist: the club's fields, each
  // recruiting cycle's fields (dates, stages, links), and the selectivity counts.
  const cycles = profile.cycles.map((c) => ({ ...c, fields: publicFields(c.fields) }));
  // The current cycle is often the same detailed object, fields included.
  const cur = profile.currentCycle as (typeof profile.currentCycle & { fields?: Record<string, StoredField> }) | null;
  const currentCycle = cur?.fields ? { ...cur, fields: publicFields(cur.fields) } : cur;
  const selectivity = profile.selectivity
    ? {
        ...profile.selectivity,
        applicants: publicValue(profile.selectivity.applicants),
        admits: publicValue(profile.selectivity.admits),
      }
    : null;
  const joiningBasis = publicJoiningBasis(profile.joiningBasis);
  const scrubbed = scrub(
    { ...profile, links, sources, fields, cycles, currentCycle, selectivity, joiningBasis },
    names,
  ) as ClubProfile;
  return { ...scrubbed, fields: scrubbed.fields as Record<string, StoredField> };
}

/** A derived fact's basis as published: rule, claim ids and pages (no quotes, no source ids). */
function publicJoiningBasis(basis: Joining["basis"] | undefined): Joining["basis"] {
  const page = (s: BasisSource): BasisSource => ({
    url: s.url,
    title: s.title,
    sourceType: s.sourceType,
    observedAt: s.observedAt,
    isFixture: s.isFixture,
  });
  const one = (b: JoiningBasis): JoiningBasis => ({
    rule: b.rule,
    claimIds: [...b.claimIds],
    sources: b.sources.map(page),
    ...(b.contrary ? { contrary: { claimIds: [...b.contrary.claimIds], sources: b.contrary.sources.map(page) } } : {}),
  });
  return Object.fromEntries(Object.entries(basis ?? {}).map(([k, b]) => [k, one(b)]));
}

function publicFields(fields: Record<string, StoredField>): Record<string, StoredField> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, f]) => [
      k,
      f.kind === "single"
        ? {
            kind: "single" as const,
            current: publicValue(f.current),
            alternatives: PUBLIC_ALTERNATIVES.has(k) ? f.alternatives.map(publicValue) : [],
            conflict: f.conflict,
          }
        : { kind: "multi" as const, values: f.values.map(publicValue) },
    ]),
  );
}
