import { matchesNoComp, matchesOpenJoin, similarClubs, type IndexClub } from "@hci/db/local";

/**
 * An index row trimmed for a profile's "Missed this deadline?" box: what the recruiting
 * section builders read, without the search fields (they'd bloat every profile's payload).
 */
export function slimClub(c: IndexClub): IndexClub {
  return { ...c, searchNames: "", searchAcronyms: [], searchTopics: "", aliases: [] };
}

/** A similar club the alternatives box may offer, with why it's similar. */
export interface AlternativeCandidate {
  club: IndexClub;
  /** "Also Consulting". */
  reason: string | null;
  /** The College directory lists no comping requirement (an application may remain). */
  noComp: boolean;
}

/** Similar clubs that might be another way in (filtered live in the browser). PURE. */
export function alternativeCandidates(
  target: IndexClub,
  index: { clubs: IndexClub[]; categories: { slug: string; name: string; parentSlug: string | null }[] },
): AlternativeCandidate[] {
  const isLeaf = (s: string) => !index.categories.some((c) => c.parentSlug === s);
  const name = (s: string) => index.categories.find((c) => c.slug === s)?.name ?? s;
  return similarClubs(target, index.clubs, { limit: 24, isLeaf })
    .filter(
      (s) =>
        s.club.cycles.length > 0 ||
        matchesOpenJoin(s.club) ||
        matchesNoComp(s.club) ||
        s.club.recruitingSeasons.includes("rolling"),
    )
    .slice(0, 12)
    .map(({ club: c, reasons }) => {
      const cat = reasons.find((r) => r.startsWith("cat:"));
      return { club: slimClub(c), reason: cat ? `Also ${name(cat.slice(4))}` : null, noComp: matchesNoComp(c) };
    });
}
