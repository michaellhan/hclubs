import { nameForms, namesClub, plain } from "../text";
import type { AuditData, AuditFinding } from "../types";

/**
 * News-mention checks. PURE. A mention is evidence only if its quoted sentence (or the
 * headline) names the club; an acronym alone is weak when another club shares it, and a
 * name that is a strict part of another club's longer name points at that club instead.
 */

const OTHER_SCHOOL =
  /\b(business school|law school|kennedy school|medical school|hbs|hls|hks|gsas|gsd|extension school)\b/i;

export function checkPress(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const clubs = [...data.clubs.values()];
  const acronymOwners = new Map<string, number>();
  for (const c of clubs)
    if (c.acronym) acronymOwners.set(plain(c.acronym), (acronymOwners.get(plain(c.acronym)) ?? 0) + 1);

  for (const claim of data.claims) {
    if (claim.fieldKey !== "club.press_mention") continue;
    const club = data.clubs.get(claim.clubId);
    if (!club) continue;
    const v = claim.value as { title?: string; url?: string };
    const quote = claim.evidence.map((e) => e.quote ?? "").join(" ");
    const text = `${v.title ?? ""} . ${quote}`;
    const base = {
      area: "press" as const,
      clubId: club.id,
      slug: club.slug,
      subject: v.url ?? v.title ?? claim.id,
      displayed: club.displayedClaimIds.has(claim.id),
    };
    if (!quote.trim()) continue;
    if (!namesClub(text, club)) {
      // The press stage keeps only a sentence's first 240 characters: a cut sentence may
      // name the club after the cut, so it can only be reviewed.
      const cut = claim.evidence.some((e) => (e.quote ?? "").length >= 239);
      out.push({
        ...base,
        check: cut ? "press.name_after_cut" : "press.does_not_name_club",
        severity: cut ? "medium" : "high",
        confidence: cut ? "low" : "high",
        detail: `neither headline nor quote names the club: "${quote.slice(0, 110)}"`,
        fix: cut
          ? null
          : {
              kind: "reject_claims",
              claimIds: [claim.id],
              reason: "audit press.does_not_name_club: the quoted text doesn't name the club",
            },
      });
      continue;
    }
    // Named only by an acronym another club also uses.
    const t = ` ${plain(text)} `;
    const longForms = nameForms(club).filter((f) => f !== plain(club.acronym ?? "~"));
    if (
      club.acronym &&
      !longForms.some((f) => t.includes(` ${f} `)) &&
      (acronymOwners.get(plain(club.acronym)) ?? 0) > 1
    )
      out.push({
        ...base,
        check: "press.acronym_collision",
        severity: "medium",
        confidence: "medium",
        detail: `named only as "${club.acronym}", which another club also uses`,
        fix: null,
      });
    // The club's name appears only inside a longer name of another club ("Foreign Policy
    // Initiative" vs "Women in Foreign Policy").
    const longer = clubs.find(
      (o) =>
        o.id !== club.id &&
        plain(o.name).length > plain(club.name).length &&
        plain(o.name).includes(plain(club.name).replace(/^(the|harvard) /, "")) &&
        t.includes(` ${plain(o.name).replace(/^(the|harvard) /, "")} `),
    );
    if (longer)
      out.push({
        ...base,
        check: "press.names_longer_club",
        severity: "medium",
        confidence: "medium",
        detail: `the text names "${longer.name}", whose name contains this club's`,
        fix: null,
      });
    if (club.college && OTHER_SCHOOL.test(text) && !/\b(undergraduate|college)\b/i.test(text))
      out.push({
        ...base,
        check: "press.other_school",
        severity: "low",
        confidence: "low",
        detail: "the story is about a graduate-school context",
        fix: null,
      });
  }
  return out;
}
