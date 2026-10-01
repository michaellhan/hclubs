import { and, desc, eq } from "drizzle-orm";
import { computeConfidence, type SourceType } from "@hci/core";
import { finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";

/**
 * Categories a club's own name settles (ADR 0034): "Harvard Undergraduate Black Premedical
 * Society" is a health/medicine group whatever else it is. Each rule is a short, explicit
 * pattern; the claim is `inferred` (shown as an estimate, like LLM categories) and its
 * evidence is the listing that gave the club its name, with the name as the quote. Only
 * categories the club lacks are added. Words that mislead are left out on purpose:
 * "Ventures" (Harvard Data Ventures is a data group), "Debating Society" alone (the John
 * Adams Society is a discussion society), "Model UN/Congress" (they organize conferences).
 */

export const NAME_CATEGORY_EXTRACTOR = { name: "name-category", version: "1" } as const;

export const NAME_CATEGORY_RULES: readonly { category: string; pattern: RegExp }[] = [
  { category: "consulting", pattern: /\bconsult(ing|ancy|ants?)\b/i },
  {
    category: "finance",
    pattern: /\b(finance|financial|investing|investment|investors?|capital|trading|traders|banking|securities)\b/i,
  },
  // "nursing" only when it isn't "nursing homes" (Music in Hospitals and Nursing Homes).
  {
    category: "medicine-health",
    pattern: /\b(pre-?med(ical)?|medical|medicine|health|nursing(?! homes?)|pre-?dental|pre-?veterinary|surgery)\b/i,
  },
  { category: "law", pattern: /\b(pre-?law|law|legal|mock trial|moot court)\b/i },
  {
    category: "technology",
    pattern:
      /\b(computer|computing|robotics|engineering|engineers|software|coding|cybersecurity|machine intelligence|artificial intelligence|tech|technology|hackathon|aerospace|aeronautics)\b/i,
  },
  // "AI" only in capitals ("Women in AI"), never the word "ai" inside other text.
  { category: "technology", pattern: /\bAI\b/ },
  { category: "entrepreneurship", pattern: /\b(entrepreneurs?|entrepreneurship|startups?|founders)\b/i },
  {
    category: "competition-teams",
    pattern: /\b(debate (council|union|team)|debating union|parliamentary debate|mock trial|moot court|quiz bowl)\b/i,
  },
  { category: "publications-media", pattern: /\b(review|journal|magazine|newspaper|radio|television|yearbook)\b/i },
];

/** Categories the name settles. PURE. */
/** Names where a rule's word means something else. */
const NAME_CATEGORY_EXCEPTIONS: readonly { category: string; pattern: RegExp }[] = [
  // "Yan Xin Life Science and Technology" is a qigong practice group.
  { category: "technology", pattern: /\blife science and technology\b/i },
];

export function categoriesFromName(name: string): string[] {
  return [
    ...new Set(
      NAME_CATEGORY_RULES.filter(
        (r) =>
          r.pattern.test(name) &&
          !NAME_CATEGORY_EXCEPTIONS.some((x) => x.category === r.category && x.pattern.test(name)),
      ).map((r) => r.category),
    ),
  ];
}

export async function runNameCategories(
  db: Db,
  opts: { dryRun?: boolean; now?: Date },
): Promise<{ added: { slug: string; category: string }[] }> {
  const now = opts.now ?? new Date();
  const clubs = await db
    .select({ id: schema.club.id, slug: schema.club.slug, name: schema.club.canonicalName })
    .from(schema.club)
    .where(eq(schema.club.recordState, "active"));
  const added: { slug: string; category: string }[] = [];
  const touched: string[] = [];
  const runId = opts.dryRun
    ? null
    : await startRun(db, {
        job: "categorize-names",
        adapter: NAME_CATEGORY_EXTRACTOR.name,
        adapterVersion: NAME_CATEGORY_EXTRACTOR.version,
        options: {},
      });
  for (const c of clubs) {
    const wanted = categoriesFromName(c.name);
    if (!wanted.length) continue;
    const have = new Set(
      (
        await db
          .select({ slug: schema.category.slug })
          .from(schema.clubCategory)
          .innerJoin(schema.category, eq(schema.category.id, schema.clubCategory.categoryId))
          .where(eq(schema.clubCategory.clubId, c.id))
      ).map((r) => r.slug),
    );
    const missing = wanted.filter((w) => !have.has(w));
    if (!missing.length) continue;
    // The listing that named the club is the evidence: its snapshot holds the name.
    const [ev] = await db
      .select({
        sourceId: schema.claimEvidence.sourceId,
        snapshotId: schema.claimEvidence.snapshotId,
        sourceType: schema.source.sourceType,
        tier: schema.source.trustTier,
      })
      .from(schema.claim)
      .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
      .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
      .where(
        and(eq(schema.claim.clubId, c.id), eq(schema.claim.fieldKey, "club.name"), eq(schema.claim.status, "active")),
      )
      .orderBy(schema.source.trustTier, desc(schema.claimEvidence.observedAt))
      .limit(1);
    if (!ev) continue;
    for (const category of missing) {
      added.push({ slug: c.slug, category });
      if (opts.dryRun) continue;
      await upsertClaim(
        db,
        { clubId: c.id, fieldKey: "club.category", value: category, assertionKind: "inferred" },
        {
          sourceId: ev.sourceId,
          sourceType: ev.sourceType as SourceType,
          snapshotId: ev.snapshotId,
          ingestionRunId: runId,
          observedAt: now,
          quote: c.name,
          locator: { signal: "category settled by the club's name" },
          extractionMethod: "html_parse",
          extractorName: NAME_CATEGORY_EXTRACTOR.name,
          extractorVersion: NAME_CATEGORY_EXTRACTOR.version,
          isDirect: false,
          confidence: computeConfidence({
            sourceType: ev.sourceType as SourceType,
            trustTier: ev.tier,
            extractionMethod: "html_parse",
            isDirect: false,
          }),
        },
      );
    }
    touched.push(c.id);
  }
  if (!opts.dryRun && touched.length) await resolveClubs(db, { clubIds: touched, now });
  if (runId)
    await finishRun(db, runId, {
      status: "succeeded",
      counters: { categoriesAdded: added.length, clubs: touched.length },
    });
  return { added };
}
