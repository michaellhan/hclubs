import { normalizeName } from "@hci/core";
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
