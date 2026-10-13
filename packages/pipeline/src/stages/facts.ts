import { and, eq } from "drizzle-orm";
import { SOURCE_TYPE_TIER, isOwnSubdomain, normalizeUrl, siteKey, type SourceType } from "@hci/core";
import { ensureRecruitingCycle, finishRun, resolveClubs, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats } from "../crawl/site";
import { CURATED_FACTS, CURATED_FACTS_VERSION, CuratedFactsEntry, type CuratedFact } from "../curated/facts";
import {
  duesProblem,
  eligibleClassesProblem,
  freshmenEligibleProblem,
  hoursProblem,
  joinModeProblem,
  memberCountProblem,
  namesPeopleProblem,
  numberAppears,
  stageKindFromLabel,
} from "../extract/evidence-rules";
import type { Logger } from "../logger";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import type { DocLink } from "../parse/document";
import { missingQuotes } from "./lifecycle";

/**
 * facts (ADR 0044): write the editor-read facts in `curated/facts.ts`. Each entry's page is
 * fetched; a fact is written only when its quote is on the page verbatim and passes the same
 * evidence rules the extractors use (numbers literal, join modes not negated or about a
 * role, first-year wording that actually opens membership). The page's tier is its own:
 * the club's website only when the host is the club's verified site or a subdomain of it.
 */
export const FACTS_EXTRACTOR = "curated-facts";

const flatText = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Why a link fact isn't on its page, or null: the URL must be a body link of the page (never
 * nav/footer chrome), and the words it is linked from must be part of the quote. PURE.
 */
export function linkFactProblem(url: string, quote: string, pageLinks: readonly DocLink[]): string | null {
  const key = normalizeUrl(url) ?? url;
  const onPage = pageLinks.filter((l) => !l.chrome && (normalizeUrl(l.url) ?? l.url) === key);
  if (onPage.length === 0) return "the page does not link this URL in its body";
  if (!onPage.some((l) => l.text.trim().length >= 3 && flatText(quote).includes(flatText(l.text))))
    return "the link's own text is not in the quote";
  return null;
}

/** Why a fact's quote doesn't support its value, or null. PURE. */
export function factProblem(fact: CuratedFact, pageText: string, pageLinks: readonly DocLink[] = []): string | null {
  if (fact.field === "club.link") return linkFactProblem(fact.value.url, fact.quote, pageLinks);
  const p = (() => {
    switch (fact.field) {
      case "club.join_mode":
      case "cycle.process_type":
        return joinModeProblem(fact.value, fact.quote, pageText);
      case "club.freshmen_eligible":
        return freshmenEligibleProblem(fact.value, fact.quote);
      case "club.eligible_classes":
        return eligibleClassesProblem(fact.value, fact.quote);
      case "club.hours_per_week":
        return hoursProblem(
          fact.quote,
          [fact.value.min, fact.value.max].filter((n): n is number => n !== null),
        );
      case "club.member_count":
        return memberCountProblem(
          fact.quote,
          fact.value.kind === "exact"
            ? [fact.value.count]
            : [fact.value.min, fact.value.max].filter((n): n is number => n !== null),
        );
      case "club.dues":
        // What the amount covers ("6 months") is read off the quote too, word for word.
        if (fact.value.period && !flatText(fact.quote).includes(flatText(fact.value.period)))
          return { check: "period_not_in_quote", why: `"${fact.value.period}" is not in the quote` };
        return duesProblem(fact.quote, fact.value.amountUsd);
      default:
        return null;
    }
  })();
  if (p) return p.why;
  // A round's facts: the quote names the term's season ("Spring Comp"), so the term isn't guessed.
  if (
    fact.field === "cycle.process_type" ||
    fact.field === "cycle.self_described_selectivity" ||
    fact.field === "cycle.stages"
  ) {
    const season = fact.term.split("-")[1] ?? "";
    if (!new RegExp(`\\b${season}\\b`, "i").test(fact.quote)) return `the quote doesn't name the ${season} round`;
  }
  // Each stage is the page's own words, in its order, and no more specific than its label says.
  if (fact.field === "cycle.stages") {
    const quote = flatText(fact.quote);
    let at = -1;
    for (const [i, stage] of fact.value.entries()) {
      if (stage.order !== i + 1) return "stages must be numbered 1, 2, 3… in order";
      const found = quote.indexOf(flatText(stage.label), at + 1);
      if (found < 0) return `the stage "${stage.label}" is not in the quote in this order`;
      at = found;
      if (stageKindFromLabel(stage.kind, stage.label) !== stage.kind)
        return `"${stage.label}" doesn't say it is a ${stage.kind.replace(/_/g, " ")}`;
    }
  }
  if (
    fact.field === "club.mission" ||
    fact.field === "club.long_description" ||
    fact.field === "club.activity" ||
    fact.field === "club.short_description" ||
    fact.field === "cycle.self_described_selectivity"
  ) {
    const flat = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
    if (!flat(fact.quote).includes(flat(fact.value))) return "the value is not in its quote verbatim";
    // No individual's name in club text (§4, §21; ADR 0033 amendment).
    const people = namesPeopleProblem(fact.value);
    if (people) return people.why;
  }
  // A one-liner reads as a whole sentence and carries nothing to act on (links, addresses).
  if (fact.field === "club.short_description") {
    if (!/[.!?]$/.test(fact.value)) return "a one-line description must end like a sentence";
    if (/https?:\/\/|www\.|@\w/.test(fact.value)) return "a one-line description carries no links or addresses";
  }
  // An acronym only as the page writes it: the same letters and case, as a word of its own.
  if (fact.field === "club.acronym") {
    const esc = fact.value.replace(/[&-]/g, "\\$&");
    if (!new RegExp(`(^|[^A-Za-z0-9])${esc}(?![A-Za-z0-9])`).test(fact.quote))
      return "the acronym is not a word of its quote";
  }
  // Any number in a free-text value must be on the page too.
  if (fact.field === "club.experience_required" || fact.field === "club.meeting_frequency") {
    const nums = (fact.value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const missing = nums.filter((n) => !numberAppears(n, fact.quote));
    if (missing.length) return `${missing.join(", ")} does not appear in the quote`;
  }
  return null;
}

/**
 * Hosts of the Harvard offices our tier-1 directory adapters read (adapters/directories.ts,
 * pbha-programs, soco-directory). A page there is the office's own page about the club, so
 * an editor-read fact from it carries that tier, never public_web.
 */
export const HARVARD_OFFICE_HOSTS: ReadonlySet<string> = new Set([
  "iop.harvard.edu",
  "seas.harvard.edu",
  "csadvising.seas.harvard.edu",
  "mcb.harvard.edu",
  "careerservices.fas.harvard.edu",
  "innovationlabs.harvard.edu",
  "pbha.org",
]);

/**
 * The better (lower-tier) of the type this stage worked out and the type the source row
 * already has: the row never downgrades (`upsertSource`), so a page a directory adapter
 * established as harvard_official keeps that tier for a fact's evidence. PURE.
 */
export function betterSourceType(computed: SourceType, existing: string | null | undefined): SourceType {
  if (!existing || !Object.hasOwn(SOURCE_TYPE_TIER, existing)) return computed;
  const known = existing as SourceType;
  return SOURCE_TYPE_TIER[known] < SOURCE_TYPE_TIER[computed] ? known : computed;
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * The page's source type: the club's own site only when its host is the verified website,
 * or a subdomain of it (comp.thecrimson.com beside thecrimson.com; never under a
 * path-scoped site or a school's shared host, `isOwnSubdomain`). PURE.
 */
export function factsSourceType(url: string, verifiedSites: readonly string[]): SourceType {
  const host = hostOf(url);
  const path = new URL(url).pathname;
  for (const site of verifiedSites) {
    const s = new URL(site);
    const sitePath = s.pathname.replace(/\/$/, "");
    if (hostOf(site) === host && (sitePath === "" || path.startsWith(sitePath))) return "club_website";
    const key = siteKey(site);
    if (sitePath === "" && key !== null && isOwnSubdomain(url, key)) return "club_website";
  }
  if (HARVARD_OFFICE_HOSTS.has(host)) return "harvard_official";
  // SOCO hosts each club's own pages; only the Club Sports Office's pages speak for the office.
  if (host === "soco.college.harvard.edu" && path.startsWith("/clubsports/")) return "harvard_official";
  if (host === "thecrimson.com") return "harvard_crimson";
  if (host === "news.harvard.edu") return "harvard_related_other"; // the Harvard Gazette
  return "public_web";
}

export interface FactsOutcome {
  slug: string;
  url: string;
  result: string;
}

export async function runFacts(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean; entries?: CuratedFactsEntry[]; slugs?: string[] } = {},
): Promise<{ runId: string; outcomes: FactsOutcome[]; errors: string[] }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const entries = (opts.entries ?? CURATED_FACTS)
    .map((e) => CuratedFactsEntry.parse(e))
    .filter((e) => !opts.slugs?.length || opts.slugs.includes(e.slug));
  const runId = await startRun(db, {
    job: "facts",
    adapter: FACTS_EXTRACTOR,
    adapterVersion: CURATED_FACTS_VERSION,
    options: { dryRun: opts.dryRun ?? false, entries: entries.length },
  });
  const crawl = emptyCrawlStats();
  const outcomes: FactsOutcome[] = [];
  const errors: string[] = [];
  const touched = new Set<string>();
  let written = 0;

  for (const entry of entries) {
    const out: FactsOutcome = { slug: entry.slug, url: entry.url, result: "" };
    outcomes.push(out);
    try {
      const [club] = await db
        .select({ id: schema.club.id, state: schema.club.recordState })
        .from(schema.club)
        .where(eq(schema.club.slug, entry.slug));
      if (!club || club.state !== "active") throw new Error(`club ${entry.slug} not found or not active`);
      const sites = await db
        .select({ url: schema.clubLink.url })
        .from(schema.clubLink)
        .where(
          and(
            eq(schema.clubLink.clubId, club.id),
            eq(schema.clubLink.kind, "website"),
            eq(schema.clubLink.status, "verified"),
          ),
        );
      const computedType = factsSourceType(
        entry.url,
        sites.map((s) => s.url),
      );
      const read = (force: boolean) =>
        crawlSite({
          rootUrl: entry.url,
          clubId: club.id,
          officialSite: computedType === "club_website",
          sourceTypeOverride: computedType,
          db,
          fetcher: deps.fetcher,
          store: deps.store,
          runId,
          logger: logger.child({ slug: entry.slug }),
          now,
          maxPages: 1,
          maxDepth: 0,
          freshnessMs: 7 * 86_400_000,
          force,
          stats: crawl,
          fetchRootAsGiven: true,
        });
      let [page] = await read(false);
      // A stored copy that is an empty JS shell (e.g. fetched without the URL's trailing slash)
      // says nothing: read the page again exactly as the entry gives it.
      if (page?.doc.looksJsRendered) [page] = await read(true);
      if (!page) throw new Error(`could not fetch ${entry.url}`);
      const [row] = await db
        .select({ sourceType: schema.source.sourceType, ownerClubId: schema.source.ownerClubId })
        .from(schema.source)
        .where(eq(schema.source.id, page.sourceId));
      // Another club's own channel (a PBHA program's page on pbha.org) isn't this club's.
      const established =
        row && (!row.sourceType.startsWith("club_") || row.ownerClubId === club.id) ? row.sourceType : null;
      const sourceType = betterSourceType(computedType, established);

      const problems: string[] = [];
      const good: CuratedFact[] = [];
      for (const fact of entry.facts) {
        const missing = missingQuotes(page.doc.text, [fact.quote]);
        const why = missing.length
          ? `quote not on the page: "${fact.quote.slice(0, 80)}"`
          : factProblem(fact, page.doc.text, page.doc.links);
        if (why) problems.push(`${fact.field}: ${why}`);
        else good.push(fact);
      }
      if (!opts.dryRun) {
        for (const fact of good) {
          const cycle =
            "term" in fact
              ? {
                  recruitingCycleId: await ensureRecruitingCycle(db, { clubId: club.id, termKey: fact.term }),
                  termKey: fact.term,
                }
              : {};
          await upsertClaim(
            db,
            { clubId: club.id, fieldKey: fact.field, value: fact.value, assertionKind: "stated", ...cycle },
            {
              sourceId: page.sourceId,
              sourceType,
              snapshotId: page.snapshotId,
              ingestionRunId: runId,
              observedAt: page.fetchedAt,
              quote: fact.quote,
              locator: { url: page.url, signal: "editor-read fact; quote verified in the page text" },
              extractionMethod: "manual",
              extractorName: FACTS_EXTRACTOR,
              extractorVersion: CURATED_FACTS_VERSION,
              isDirect: true,
            },
          );
          written++;
        }
        if (good.length) {
          await db.insert(schema.editorialDecision).values({
            actor: FACTS_EXTRACTOR,
            action: "record_facts",
            targetType: "club",
            targetId: club.id,
            reason: good.map((f) => f.field).join(", "),
            payload: { url: entry.url, listVersion: CURATED_FACTS_VERSION, sourceType },
          });
          touched.add(club.id);
        }
      }
      out.result = `${opts.dryRun ? "would write" : "wrote"} ${good.length}/${entry.facts.length} (${sourceType})`;
      if (problems.length) {
        out.result += `; rejected: ${problems.join(" | ")}`;
        errors.push(`${entry.slug}: ${problems.join(" | ")}`);
      }
    } catch (error) {
      out.result = `error: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(`${entry.slug}: ${out.result}`);
    }
  }

  const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
  errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
  await finishRun(db, runId, {
    status: errors.length ? "partial" : "succeeded",
    counters: { ...crawl, entries: entries.length, written },
    errorSummary: errors.slice(0, 50).join("\n") || null,
  });
  return { runId, outcomes, errors };
}
