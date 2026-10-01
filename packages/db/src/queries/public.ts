import { emailPublishProblem } from "@hci/core";
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

/** A search API request as the public results page a person can open. */
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
  return { url, title: null };
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

export function publicProfile(profile: ClubProfile): ClubProfile {
  const names = [profile.name, ...(profile.acronym ? [profile.acronym] : []), ...profile.aliases.map((a) => a.alias)];
  const links = profile.links.filter((l) => {
    if (l.kind !== "email") return true;
    return !emailPublishProblem(l.url.replace(/^mailto:/i, ""), names);
  });
  const sources: SourceDisplay[] = profile.sources.map((s) => {
    const p = publicSourceUrl(s.url);
    return { ...s, url: p.url, title: p.title ?? s.title };
  });
  const fields = Object.fromEntries(
    Object.entries(profile.fields).map(([k, f]) => [
      k,
      f.kind === "single" && !PUBLIC_ALTERNATIVES.has(k) ? { ...f, alternatives: [] } : f,
    ]),
  );
  const scrubbed = scrub({ ...profile, links, sources, fields }, names) as ClubProfile;
  return { ...scrubbed, fields: scrubbed.fields as Record<string, StoredField> };
}
