/**
 * Organization-name normalization. CLAUDE.md §12.
 *
 * `normalizeName` keeps every meaningful token (including "harvard", "undergraduate")
 * because those tokens can distinguish genuinely different organizations.
 * `blockingKey` strips common noise tokens and is used ONLY to find candidates,
 * never to decide a match on its own.
 */

const NOISE_TOKENS = new Set([
  "the",
  "harvard",
  "college",
  "undergraduate",
  "undergraduates",
  "hc",
  "club",
  "society",
  "association",
  "organization",
  "org",
  "of",
  "at",
  "for",
  "and",
]);

export function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function normalizeName(input: string): string {
  let s = stripDiacritics(input).toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/['‘’ʼ`]/g, ""); // women's -> womens
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.trim().replace(/\s+/g, " ");
  if (s.startsWith("the ")) s = s.slice(4);
  return s;
}

export function nameTokens(input: string): string[] {
  const n = normalizeName(input);
  return n === "" ? [] : n.split(" ");
}

export function blockingKey(input: string): string {
  const tokens = nameTokens(input).filter((t) => !NOISE_TOKENS.has(t));
  return tokens.join(" ");
}

export function slugify(input: string, maxLength = 80): string {
  const slug = normalizeName(input).replace(/ /g, "-");
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

/** Normalized acronym: letters/digits only, uppercase. "H.U.C.G." -> "HUCG". */
export function normalizeAcronym(input: string): string {
  return stripDiacritics(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Heuristic: is a token plausibly an acronym (e.g. "HUCG", "HCS", "WHRB")? */
export function looksLikeAcronym(input: string): boolean {
  const trimmed = input.trim();
  return /^[A-Z][A-Z0-9&.]{1,9}$/.test(trimmed) && normalizeAcronym(trimmed).length >= 2;
}

/**
 * Derive the initials of a name, e.g. "Harvard Computer Society" -> "HCS".
 * Used only as a weak matching signal, never displayed as an acronym claim.
 */
export function initialsOf(input: string): string {
  return nameTokens(input)
    .filter((t) => !["of", "and", "the", "for", "at"].includes(t))
    .map((t) => t[0] ?? "")
    .join("")
    .toUpperCase();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Trigram similarity in [0, 1] (Jaccard, similar in spirit to pg_trgm). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(normalizeName(a));
  const tb = trigrams(normalizeName(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}
