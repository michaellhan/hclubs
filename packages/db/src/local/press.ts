import { normalizeName } from "@hci/core/browser";

/**
 * Order a club's news mentions (launch audit): articles whose headline names the club first,
 * newest first within each group. A mention only means the article names the club
 * somewhere, so a 1991 list of class-marshal candidates shouldn't outrank a feature about
 * the club. PURE.
 */

const GENERIC = new Set([
  "harvard",
  "radcliffe",
  "undergraduate",
  "undergraduates",
  "college",
  "the",
  "of",
  "and",
  "at",
  "club",
  "society",
  "association",
  "group",
  "organization",
  "pbhas",
  "pbha",
]);

/** Whether `title` names the club: its distinctive words in order, or its acronym. */
export function headlineNamesClub(title: string, club: { name: string; acronym?: string | null }): boolean {
  const core = normalizeName(club.name)
    .split(" ")
    .filter((w) => w && !GENERIC.has(w));
  const t = ` ${normalizeName(title)} `;
  if (core.length && core.join(" ").length >= 4 && t.includes(` ${core.join(" ")} `)) return true;
  const a = club.acronym?.trim();
  return Boolean(a && a.length >= 3 && new RegExp(`\\b${a.replace(/[^A-Za-z0-9]/g, "")}\\b`).test(title));
}

export function rankPressMentions<T extends { mention: { title: string; publishedOn: string; url: string } }>(
  mentions: readonly T[],
  club: { name: string; acronym?: string | null },
): T[] {
  const named = (m: T) => (headlineNamesClub(m.mention.title, club) ? 0 : 1);
  return [...mentions].sort(
    (a, b) =>
      named(a) - named(b) ||
      b.mention.publishedOn.localeCompare(a.mention.publishedOn) ||
      a.mention.url.localeCompare(b.mention.url),
  );
}
