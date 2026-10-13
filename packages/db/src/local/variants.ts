/**
 * Spelling variants of a normalized query word, so "robot" finds "Robotics Club"'s
 * "robots", "theatre" finds "theater" and "society" finds "societies". Deliberately small:
 * plural/singular forms and a few US/UK spellings — no general stemmer, which would make
 * "arts" match "article" or "policy" match "police". PURE, browser-safe.
 */

/** UK → US spellings (both directions are generated). */
const SPELLINGS: Record<string, string> = {
  theatre: "theater",
  theatres: "theaters",
  centre: "center",
  colour: "color",
  programme: "program",
  defence: "defense",
  organisation: "organization",
  organise: "organize",
  favourite: "favorite",
  labour: "labor",
  honour: "honor",
  judgement: "judgment",
  catalogue: "catalog",
  practise: "practice",
  behaviour: "behavior",
  behavioural: "behavioral",
};
const REVERSE = Object.fromEntries(Object.entries(SPELLINGS).map(([uk, us]) => [us, uk]));

/**
 * Demonym ↔ place ("chinese" ↔ "china"): a student typing "chinese" means the China Forum
 * too, and "korea" means the Korean Association. Only pairs whose two forms mean the same
 * community; "american"/"asian" are left out (too broad: "Model Congress Asia").
 */
const PLACES: Record<string, string> = {
  chinese: "china",
  korean: "korea",
  japanese: "japan",
  vietnamese: "vietnam",
  taiwanese: "taiwan",
  indian: "india",
  pakistani: "pakistan",
  bangladeshi: "bangladesh",
  nepali: "nepal",
  filipino: "philippines",
  thai: "thailand",
  indonesian: "indonesia",
  mexican: "mexico",
  brazilian: "brazil",
  nigerian: "nigeria",
  ghanaian: "ghana",
  ethiopian: "ethiopia",
  israeli: "israel",
  irish: "ireland",
  italian: "italy",
  french: "france",
  german: "germany",
  russian: "russia",
  ukrainian: "ukraine",
  armenian: "armenia",
  palestinian: "palestine",
  lebanese: "lebanon",
  syrian: "syria",
  egyptian: "egypt",
  iranian: "iran",
  somali: "somalia",
  eritrean: "eritrea",
  kenyan: "kenya",
  african: "africa",
  european: "europe",
};
const PLACE_REVERSE = Object.fromEntries(Object.entries(PLACES).map(([d, p]) => [p, d]));

/** Words whose trailing "s" isn't a plural ("physics", "class", "chess"). */
const NOT_PLURAL = /(ss|us|is|ics|ous|ws)$/;

/** The other of a US/UK spelling pair ("theatre" → "theater"), or null. PURE. */
export function otherSpelling(word: string): string | null {
  return SPELLINGS[word] ?? REVERSE[word] ?? null;
}

const cache = new Map<string, readonly string[]>();

/** The word itself first, then its variants (deduplicated). */
export function wordVariants(word: string): readonly string[] {
  let v = cache.get(word);
  if (v) return v;
  const out = new Set<string>([word]);
  const spelled = SPELLINGS[word] ?? REVERSE[word];
  if (spelled) out.add(spelled);
  if (word.length >= 3 && !/\d/.test(word)) {
    if (word.endsWith("ies") && word.length > 4) out.add(`${word.slice(0, -3)}y`);
    else if (/(ches|shes|xes|sses|zes)$/.test(word)) out.add(word.slice(0, -2));
    else if (word.endsWith("s") && !NOT_PLURAL.test(word)) out.add(word.slice(0, -1));
    else if (!word.endsWith("s")) {
      if (/[^aeiou]y$/.test(word)) out.add(`${word.slice(0, -1)}ies`);
      else if (/(ch|sh|x|z)$/.test(word)) out.add(`${word}es`);
      else out.add(`${word}s`);
    }
  }
  for (const w of [...out]) {
    const s = SPELLINGS[w] ?? REVERSE[w];
    if (s) out.add(s);
  }
  const place = PLACES[word] ?? PLACE_REVERSE[word];
  if (place) out.add(place);
  v = [...out];
  if (cache.size < 5000) cache.set(word, v);
  return v;
}
