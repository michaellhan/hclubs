/**
 * Aliases that say nothing a club's name doesn't already say (display only; search still reads
 * every alias). Browser-safe: no Zod. PURE.
 */

/** Words a name may lead with that only say where the club is ("Harvard Undergraduate …"). */
const PLACE_WORDS = new Set([
  "the",
  "harvard",
  "radcliffe",
  "college",
  "undergraduate",
  "undergraduates",
  "university",
]);

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]s\b/g, "")
    .match(/[a-z0-9]+/g) ?? [];

/** The name's words without its leading place words, and without the acronym at either end. */
function core(s: string, acronym: string | null): string[] {
  const w = words(s);
  const acr = acronym ? words(acronym).join("") : "";
  if (acr && w.length > 1 && w[w.length - 1] === acr) w.pop();
  if (acr && w.length > 1 && w[0] === acr) w.shift();
  while (w.length > 1 && PLACE_WORDS.has(w[0]!)) w.shift();
  return w;
}

/** A listing label's suffix: "Soccer M", "Volleyball W", "Ultimate (Women's)", "Boxing (Club Sport)". */
const SEX_SUFFIX =
  /\s*\(?\s*\b(?:(?:(?:men|women)['’]?s\s+)?club\s+sports?|m|w|men|women|mens|womens|men['’]s|women['’]s)\s*\)?\s*$/i;

/**
 * A directory label that is the club's own name words plus a sex suffix ("Ultimate Frisbee M"
 * beside "Harvard Men's Ultimate Frisbee Club", SOCO's club-sport list, round 7).
 */
export function restatesWithSexSuffix(alias: string, name: string): boolean {
  if (!SEX_SUFFIX.test(alias)) return false;
  const aliasCore = words(alias.replace(SEX_SUFFIX, ""));
  if (!aliasCore.length) return false;
  const inName = new Set(words(name));
  return aliasCore.every((w) => inName.has(w));
}

/**
 * Whether an alias only restates the club's name (persona round 8): the same words once the
 * place words it leads with ("Harvard", "Harvard College", "Harvard Undergraduate", "The") and
 * the club's acronym at either end ("… (WiCS)", "WiCS: …") are set aside. "Women in Computer
 * Science" and "Women in Computer Science (WiCS)" beside "Harvard Undergraduate Women in Computer
 * Science"; also the name's words with a sex suffix ("Soccer M"). A shorter or different name
 * ("Ultimate Frisbee" beside "Harvard Men's Ultimate Frisbee Club", a former name) is news.
 */
export function aliasRestatesName(alias: string, club: { name: string; acronym: string | null }): boolean {
  if (restatesWithSexSuffix(alias, club.name)) return true;
  const a = core(alias, club.acronym);
  const n = core(club.name, club.acronym);
  return a.length > 0 && a.length === n.length && a.every((w, i) => w === n[i]);
}
