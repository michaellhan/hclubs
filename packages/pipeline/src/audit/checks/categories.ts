import type { AuditData, AuditFinding } from "../types";

/**
 * Category checks. PURE. Categories are estimates (ADR 0026); this only reports
 * overclassification and categories that rest solely on where some page lists the club.
 */

/** Adapters whose category is "this page lists the club", not a statement about it. */
const LISTING_ONLY = new Set([
  "mignone-student-clubs",
  "dept-computer-science",
  "seas-orgs-by-concentration",
  "seas-student-orgs",
  "innovation-labs-student-groups",
  "dept-latinx-studies",
  "dept-mcb-neuroscience",
  "dept-math-community",
]);

/** Name words that settle a club's kind. */
const KIND_BY_NAME: [RegExp, string, string][] = [
  [
    /\b(a cappella|singers|chorus|choir|choral|glee|orchestra|band|ensemble|symphony|jazz|opera)\b/i,
    "performing-arts",
    "music group",
  ],
  [/\b(dance|ballet|bhangra|step team|troupe)\b/i, "performing-arts", "dance group"],
  [/\b(review|journal|magazine|gazette|independent|advocate|lampoon|yearbook)\b/i, "publications-media", "publication"],
  [
    /\(club sport\)|\b(rugby|lacrosse|frisbee|volleyball|hockey|soccer|fencing|rowing|squash|polo|judo|karate|taekwondo|curling|cycling|archery|badminton|cricket|climbing|skiing|sailing)\b/i,
    "athletics-recreation",
    "sports club",
  ],
];

export function checkCategories(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const catClaims = data.claims.filter((c) => c.fieldKey === "club.category");
  for (const club of data.clubs.values()) {
    if (club.topCategories.length > 3)
      out.push({
        check: "category.overclassified",
        area: "category",
        severity: "low",
        confidence: "medium",
        clubId: club.id,
        slug: club.slug,
        subject: club.topCategories.join(", "),
        detail: `${club.topCategories.length} top-level categories`,
        displayed: true,
        fix: null,
      });
    for (const [re, top, kind] of KIND_BY_NAME)
      if (re.test(club.name) && club.topCategories.length > 0 && !club.topCategories.includes(top))
        out.push({
          check: "category.contradicts_name",
          area: "category",
          severity: "medium",
          confidence: "medium",
          clubId: club.id,
          slug: club.slug,
          subject: club.topCategories.join(", "),
          detail: `the name says ${kind}, but it isn't in ${top}`,
          displayed: true,
          fix: null,
        });
    const mine = catClaims.filter((c) => c.clubId === club.id);
    if (club.topCategories.length < 3) continue;
    for (const c of mine) {
      if (!c.evidence.length || !c.evidence.every((e) => LISTING_ONLY.has(e.extractor))) continue;
      const slug = String(c.value);
      const top = data.categoryTop.get(slug) ?? slug;
      const otherwise = mine.some(
        (o) =>
          o.id !== c.id &&
          (data.categoryTop.get(String(o.value)) ?? String(o.value)) === top &&
          !o.evidence.every((e) => LISTING_ONLY.has(e.extractor)),
      );
      if (otherwise) continue;
      out.push({
        check: "category.listing_only",
        area: "category",
        severity: "low",
        confidence: "medium",
        clubId: club.id,
        slug: club.slug,
        subject: slug,
        detail: `"${slug}" comes only from a page that lists the club (${[...new Set(c.evidence.map((e) => e.extractor))].join(", ")})`,
        displayed: club.displayedClaimIds.has(c.id),
        fix: null,
      });
    }
  }
  return out;
}
