import { sql } from "drizzle-orm";
import type { Db } from "@hci/db";

/** Coverage / quality report over real (non-fixture) data. */
export async function coverageStats(db: Db): Promise<Record<string, number | string>> {
  const q = async (text: string): Promise<number> => {
    const rows = (await db.execute(sql.raw(text))) as unknown as
      { rows?: { n: string | number }[] } | { n: string | number }[];
    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    return Number(list[0]?.n ?? 0);
  };
  const real = `record_state = 'active' and data_origin <> 'fixture'`;
  const clubs = await q(`select count(*) n from club where ${real}`);
  const pct = (n: number) => (clubs ? `${((100 * n) / clubs).toFixed(1)}% (${n})` : "0");
  const withLink = (kinds: string, statuses = "'verified','probable'") =>
    q(
      `select count(distinct c.id) n from club c join club_link l on l.club_id = c.id where c.${real.replace(/ and /, " and c.")} and l.kind in (${kinds}) and l.status in (${statuses})`,
    );

  return {
    organizationsDiscovered: await q(`select count(*) n from entity_mention`),
    sourcesDiscoveryPages: await q(`select count(distinct source_id) n from entity_mention`),
    canonicalClubs: clubs,
    mergedClubs: await q(`select count(*) n from club where record_state = 'merged'`),
    mentionsAutoMatched: await q(`select count(*) n from entity_mention where resolution = 'definite'`),
    mentionsLikelyDuplicate: await q(`select count(*) n from entity_mention where resolution = 'probable'`),
    mentionsAmbiguous: await q(`select count(*) n from entity_mention where resolution = 'ambiguous'`),
    mergeCandidatesOpen: await q(`select count(*) n from merge_candidate where status = 'proposed'`),
    mergeCandidatesOpenAmbiguous: await q(
      `select count(*) n from merge_candidate where status = 'proposed' and reason = 'ambiguous'`,
    ),
    clubsWithMultipleSources: await q(`select count(*) n from club where ${real} and source_count > 1`),
    withWebsiteVerifiedOrProbable: pct(await withLink("'website'")),
    withWebsiteAnyStatus: pct(await withLink("'website'", "'verified','probable','unverified'")),
    withInstagram: pct(await withLink("'instagram'")),
    withLinkedIn: pct(await withLink("'linkedin'")),
    withAnySocial: pct(await withLink("'instagram','linkedin','facebook','x','youtube','tiktok','link_in_bio'")),
    withDescription: pct(
      await q(
        `select count(*) n from club where ${real} and (short_description is not null or long_description is not null)`,
      ),
    ),
    withJoinMode: pct(await q(`select count(*) n from club where ${real} and cardinality(join_modes) > 0`)),
    withRecruitingInfo: pct(
      await q(
        `select count(distinct c.id) n from club c join recruiting_cycle r on r.club_id = c.id where c.record_state = 'active' and c.data_origin <> 'fixture' and (r.deadline_at is not null or r.opens_at is not null or r.stated_status is not null)`,
      ),
    ),
    withHoursPerWeek: pct(
      await q(
        `select count(*) n from club where ${real} and (hours_per_week_min is not null or hours_per_week_max is not null)`,
      ),
    ),
    withMemberCount: pct(
      await q(
        `select count(*) n from club where ${real} and (member_count_min is not null or member_count_max is not null)`,
      ),
    ),
    withSelectivityNumbers: pct(
      await q(
        `select count(distinct r.club_id) n from recruiting_cycle r join club c on c.id = r.club_id where c.record_state = 'active' and c.data_origin <> 'fixture' and r.applicants is not null and r.admits is not null`,
      ),
    ),
    clubsWithCrawledSite: await q(
      `select count(distinct owner_club_id) n from source where adapter = 'site-crawler' and owner_club_id is not null`,
    ),
    sitePagesSnapshotted: await q(
      `select count(*) n from source_snapshot s join source src on src.id = s.source_id where src.adapter = 'site-crawler'`,
    ),
    pagesNeedingBrowser: await q(`select count(*) n from source where needs_browser`),
    claimsTotal: await q(
      `select count(*) n from claim c join club k on k.id = c.club_id where k.data_origin <> 'fixture'`,
    ),
    claimsFromSiteExtraction: await q(
      `select count(distinct claim_id) n from claim_evidence where extractor_name in ('site-deterministic','site-llm')`,
    ),
    clubsWithConflicts: await q(`select count(*) n from club where ${real} and cardinality(conflict_fields) > 0`),
    activityActiveOrLikely: pct(
      await q(`select count(*) n from club where ${real} and activity_status in ('active','likely_active')`),
    ),
  };
}
