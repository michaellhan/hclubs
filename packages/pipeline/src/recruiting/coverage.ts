import { sql } from "drizzle-orm";
import { termForDate, termKey } from "@hci/core";
import type { Db } from "@hci/db";

/** Recruiting coverage over real (non-fixture) active clubs, for before/after reports. */
export interface RecruitingCoverage {
  clubs: number;
  withAnyDeadline: number;
  withCurrentDeadline: number;
  withFutureDeadline: number;
  withOpensDate: number;
  withApplicationUrl: number;
  withStages: number;
  withCurrentCycle: number;
  withJoinMode: number;
  withRecruitingSeasons: number;
  withClassEligibility: number;
  withFirstYearEligibility: number;
}

export async function recruitingCoverage(db: Db, now: Date): Promise<RecruitingCoverage> {
  const current = termKey(termForDate(now));
  const [row] = (await db.execute(sql`
    with real as (select id from club where record_state = 'active' and data_origin <> 'fixture'),
    rc as (select r.* from recruiting_cycle r join real on real.id = r.club_id)
    select
      (select count(*)::int from real) as clubs,
      (select count(distinct club_id)::int from rc where deadline_at is not null) as "withAnyDeadline",
      (select count(distinct club_id)::int from rc where deadline_at is not null and term_key >= ${current}) as "withCurrentDeadline",
      (select count(distinct club_id)::int from rc where deadline_at >= ${now.toISOString()}) as "withFutureDeadline",
      (select count(distinct club_id)::int from rc where opens_at is not null and term_key >= ${current}) as "withOpensDate",
      (select count(distinct club_id)::int from rc where application_url is not null and term_key >= ${current}) as "withApplicationUrl",
      (select count(distinct rc.club_id)::int from rc join recruiting_stage s on s.cycle_id = rc.id) as "withStages",
      (select count(distinct club_id)::int from rc where term_key >= ${current}
         and (deadline_at is not null or opens_at is not null or stated_status is not null or application_url is not null)) as "withCurrentCycle",
      (select count(*)::int from club c join real on real.id = c.id where cardinality(c.join_modes) > 0) as "withJoinMode",
      (select count(*)::int from club c join real on real.id = c.id where c.fields ? 'club.recruiting_seasons') as "withRecruitingSeasons",
      (select count(*)::int from club c join real on real.id = c.id where c.fields ? 'club.eligible_classes') as "withClassEligibility",
      (select count(*)::int from club c join real on real.id = c.id where c.freshmen_eligible is not null) as "withFirstYearEligibility"
  `)) as unknown as RecruitingCoverage[];
  if (!row) throw new Error("coverage query returned nothing");
  return row;
}
