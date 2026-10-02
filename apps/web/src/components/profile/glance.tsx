import type { ReactNode } from "react";
import {
  AFFILIATION_SCOPE_LABEL,
  CLASS_YEAR_LABEL,
  JOIN_MODE_LABEL,
  type AffiliationScope,
  type ClassYear,
  type ContributionType,
  type JoinMode,
} from "@hci/core";
import type { ClubProfile } from "@hci/db";
import { Fact } from "@/components/provenance";
import { ContributeLink } from "@/components/suggest-update";
import { formatTerm } from "@/lib/format";
import { renderDues, renderHours, renderMembers } from "@/lib/render";
import { renderSeasons } from "./joining";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** A fact nobody has published yet: says so plainly and asks for it. Never looks like "no". */
function NotKnown({ club, type, ask }: { club: ClubProfile; type: ContributionType; ask: string }) {
  return (
    <span className="text-stone-500 dark:text-stone-400">
      Unknown
      {club.isFixture ? null : (
        <>
          {" · "}
          <ContributeLink club={{ name: club.name, slug: club.slug }} type={type} className="hc-link-muted">
            {ask}
          </ContributeLink>
        </>
      )}
    </span>
  );
}

const classes = (v: unknown) => (v as ClassYear[]).map((c) => CLASS_YEAR_LABEL[c]).join(", ");
const ALL_UNDERGRAD = ["first_year", "sophomore", "junior", "senior"];

/**
 * "At a glance": the facts a student checks first, always in the same order. The core
 * rows (joining, first-years, time, members, dues) always show — as "Unknown" with a
 * prefilled way to add them when no source states them — so a missing fact never reads as
 * a "no". Every known value opens to its source.
 */
export function AtAGlance({ club, noComp, travel }: { club: ClubProfile; noComp: boolean; travel: string[] }) {
  const f = club.fields;
  const eligible = club.eligibleClasses ?? [];
  const otherAffiliation = club.affiliationScope !== "unknown" && club.affiliationScope !== "harvard_college";
  const cycleFirstYears = club.cycles.find((cy) => (cy.eligibleClasses ?? []).includes("first_year")) ?? null;
  const known = [
    f["club.join_mode"] || noComp,
    f["club.freshmen_eligible"] || eligible.length,
    f["club.hours_per_week"],
    f["club.member_count"],
    f["club.dues"],
  ].filter(Boolean).length;
  // Nothing known yet: one honest line instead of five "Unknown" rows.
  if (known === 0 && !club.isFixture)
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-4 text-sm dark:border-stone-700">
        <h2 className="mb-1 text-[13px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          At a glance
        </h2>
        <p className="text-stone-600 dark:text-stone-400">
          No source we&apos;ve found says how to join, who can join, the time commitment, size or dues yet.
        </p>
        <p className="mt-2">
          <ContributeLink
            club={{ name: club.name, slug: club.slug }}
            type="joining_process"
            className="font-medium text-stone-900 underline decoration-stone-400 underline-offset-2 dark:text-stone-100"
          >
            Know how to join?
          </ContributeLink>
        </p>
      </div>
    );
  return (
    <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
      <h2 className="mb-1 text-[13px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        At a glance
      </h2>
      <dl className="divide-y divide-stone-100 dark:divide-stone-800">
        <Row label="Joining">
          {f["club.join_mode"] ? (
            <Fact field={f["club.join_mode"]} render={(v) => JOIN_MODE_LABEL[v as JoinMode]} />
          ) : noComp ? (
            <span>
              No comp required
              <span className="block text-xs text-stone-500 dark:text-stone-400">
                Per the College&apos;s student-organization directory
              </span>
            </span>
          ) : (
            <NotKnown club={club} type="joining_process" ask="Know how to join?" />
          )}
        </Row>
        <Row label="First-years">
          {f["club.freshmen_eligible"] ? (
            <Fact field={f["club.freshmen_eligible"]} render={(v) => (v ? "Eligible" : "Not eligible")} />
          ) : eligible.includes("first_year") ? (
            <Fact field={f["club.eligible_classes"]} render={() => "Eligible"} />
          ) : cycleFirstYears ? (
            // The directory's "Takes first-years" pill counts a recruiting cycle open to them too.
            <span>
              Eligible{" "}
              <span className="block text-xs text-stone-500 dark:text-stone-400">
                Per {formatTerm(cycleFirstYears.termKey)} recruiting
              </span>
            </span>
          ) : eligible.length ? (
            <span>Not among the class years listed</span>
          ) : (
            <NotKnown club={club} type="eligibility" ask="Know who can join?" />
          )}
        </Row>
        {eligible.length && !ALL_UNDERGRAD.every((c) => eligible.includes(c)) ? (
          <Row label="Open to">
            <Fact field={f["club.eligible_classes"]} render={classes} />
          </Row>
        ) : null}
        <Row label="Time">
          {f["club.hours_per_week"] ? (
            <Fact field={f["club.hours_per_week"]} render={renderHours} />
          ) : (
            <NotKnown club={club} type="time_commitment" ask="Know the time commitment?" />
          )}
        </Row>
        <Row label="Members">
          {f["club.member_count"] ? (
            <Fact field={f["club.member_count"]} render={renderMembers} />
          ) : (
            <NotKnown club={club} type="member_count" ask="Know roughly how many?" />
          )}
        </Row>
        <Row label="Dues">
          {f["club.dues"] ? (
            <Fact field={f["club.dues"]} render={renderDues} />
          ) : (
            <NotKnown club={club} type="dues" ask="Know the dues?" />
          )}
        </Row>
        {f["club.meeting_frequency"] ? (
          <Row label="Meets">
            <Fact field={f["club.meeting_frequency"]} render={(v) => String(v)} />
          </Row>
        ) : null}
        {f["club.experience_required"] ? (
          <Row label="Experience">
            <Fact field={f["club.experience_required"]} render={(v) => String(v)} />
          </Row>
        ) : null}
        {f["club.eligibility_note"] ? (
          <Row label="Eligibility">
            <Fact field={f["club.eligibility_note"]} render={(v) => String(v)} />
          </Row>
        ) : null}
        {f["club.recruiting_seasons"] ? (
          <Row label="Recruits">
            <Fact field={f["club.recruiting_seasons"]} render={(v) => `Usually ${renderSeasons(v).toLowerCase()}`} />
          </Row>
        ) : null}
        {travel.length ? (
          <Row label="Travel">
            {travel.join(", ")}
            <span className="block text-xs text-stone-500 dark:text-stone-400">Per the College directory</span>
          </Row>
        ) : null}
        {otherAffiliation ? (
          <Row label="Affiliation">
            <Fact field={f["club.affiliation_scope"]} render={(v) => AFFILIATION_SCOPE_LABEL[v as AffiliationScope]} />
          </Row>
        ) : null}
      </dl>
      {club.isFixture ? null : (
        <p className="mt-2 text-[11px] leading-4 text-stone-500 dark:text-stone-400">
          Tap a fact to see where it comes from.
        </p>
      )}
    </div>
  );
}
