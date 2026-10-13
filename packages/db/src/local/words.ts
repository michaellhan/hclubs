import { normalizeName } from "@hci/core/browser";
import type { IndexClub } from "./types";

/**
 * The words search, intents and "similar clubs" read from a club. Derived in the browser
 * from fields the index ships anyway (description, categories), so they cost no download.
 * PURE.
 */

/** Words that carry no meaning for search ("the", "and", "our"). */
const STOP = new Set(
  "the and for with our are from that this its their they them who will can into about over have has was were been also more most such than then there these those which while when where what each other all any some not but you your".split(
    " ",
  ),
);

/** Unique normalized words of some texts (2+ letters, no stopwords), space-joined. */
export function wordSet(texts: readonly string[]): string {
  const out = new Set<string>();
  for (const t of texts) for (const w of normalizeName(t).split(" ")) if (w.length >= 2 && !STOP.has(w)) out.add(w);
  return [...out].join(" ");
}

export interface ClubWords {
  /** The one-line description's words. */
  about: string;
  /** Category names, tags and activities. */
  topics: string;
}

const cache = new WeakMap<IndexClub, ClubWords>();

export function clubWords(c: IndexClub): ClubWords {
  let w = cache.get(c);
  if (!w) {
    w = {
      about: wordSet([c.shortDescription ?? ""]),
      topics: wordSet([...c.categories.map((x) => x.name), c.searchTopics ?? ""]),
    };
    cache.set(c, w);
  }
  return w;
}

/**
 * Phrases saying how often or how much members take part, as a club's own text writes them
 * (normalized): read at build time from its one-liner, long description and activities into
 * `IndexClub.pace`, so "low commitment", "no weekly meetings" and "flexible" lift the clubs
 * that say so without shipping whole descriptions (Round 14: HOOPs' "low-commitment", Elderly
 * 1-2-1's "at their own convenience", Best Buddies' "two activities per month"). Longest first.
 */
export const PACE_PHRASES: readonly string[] = [
  "low time commitment",
  "low commitment",
  "minimal time commitment",
  "minimal commitment",
  "flexible schedule",
  "flexible commitment",
  "flexible",
  "own convenience",
  "own schedule",
  "own pace",
  "once a month",
  "twice a month",
  "each month",
  "every month",
  "per month",
  "monthly",
  "once a semester",
  "one day",
  "single day",
  "one time",
  "one off",
  "service days",
  "days of service",
  "day of service",
  "every week",
  "each week",
  "once a week",
  "twice a week",
  "weekly",
  "biweekly",
];

/** The `PACE_PHRASES` some texts say, in list order (each once). PURE. */
export function paceWords(texts: readonly string[]): string[] {
  const line = ` ${texts.map((t) => normalizeName(t)).join(" | ")} `;
  const out: string[] = [];
  // "low time commitment" is said once: not also "low commitment" from the same words.
  for (const p of PACE_PHRASES) if (line.includes(` ${p} `) && !out.some((o) => o.includes(p))) out.push(p);
  return out;
}
