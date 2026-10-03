import type { ReactNode } from "react";
import type { ContributionType, RecruitingSeason } from "@hci/core";
import type { ClubProfile } from "@hci/db";
import { DerivedFact, Fact } from "@/components/provenance";
import { ContributeLink } from "@/components/suggest-update";
import { accessText, rolesText } from "@/lib/joining";
import { renderHours } from "@/lib/render";
import { JoinWhen } from "./joining-live";

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 px-3 py-2.5 sm:block">
      <dt className="text-xs text-stone-500 sm:mb-0.5 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const muted = "block text-xs text-stone-500 dark:text-stone-400";

/** A missing answer: "Unknown", plus a one-tap way to add it. Never reads like a "no". */
function Ask({ club, type, ask }: { club: ClubProfile; type: ContributionType; ask: string }) {
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

/** Whether the top-of-profile answers have anything to say beyond "Unknown" three times. */
export function hasKeyFacts(club: ClubProfile, seasons: readonly RecruitingSeason[]): boolean {
  return Boolean(
    accessText(club.joining) ||
    club.joining.firstYears !== null ||
    club.currentCycle ||
    seasons.length ||
    club.fields["club.hours_per_week"] ||
    club.fields["club.meeting_frequency"],
  );
}

/**
 * The answers a student wants in five seconds, right under what the club is: how to join
 * (and whether first-years can), by when, and how much time it takes. Each known value opens
 * to its sources; an unknown one says so and asks for it. The action buttons follow.
 */
export function KeyFacts({ club, seasons }: { club: ClubProfile; seasons: RecruitingSeason[] }) {
  const f = club.fields;
  const j = club.joining;
  const b = club.joiningBasis;
  const joinText = accessText(j);
  const roles = rolesText(j);
  const who = [
    j.conflicts.includes("firstYears")
      ? null
      : j.firstYears === true
        ? "First-years eligible"
        : j.firstYears === false
          ? "Not open to first-years"
          : null,
    j.noExperience ? "No experience needed" : null,
  ].filter((t): t is string => t !== null);
  return (
    <dl
      aria-label="Joining at a glance"
      className="grid max-w-3xl divide-y divide-stone-100 rounded-xl border border-stone-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800"
    >
      <Cell label="How to join">
        {joinText ? (
          <>
            <div className="font-medium">
              <DerivedFact basis={j.access ? b.access : b.comp} conflict={j.access === "mixed"}>
                {joinText}
              </DerivedFact>
            </div>
            {j.access === null ? (
              <span className={muted}>Per the College directory; may still apply or audition</span>
            ) : j.access === "process" && j.comp === false ? (
              <span className={muted}>No comp, per the College directory</span>
            ) : null}
          </>
        ) : (
          <Ask club={club} type="joining_process" ask="Know how?" />
        )}
        {who.length ? <span className={muted}>{who.join(" · ")}</span> : null}
        {roles ? <span className={muted}>{roles}</span> : null}
      </Cell>
      <Cell label="When">
        <JoinWhen
          cycle={club.currentCycle}
          joining={j}
          seasons={seasons}
          joinModes={club.joinModes}
          unknown={<Ask club={club} type="deadline" ask="Know a date?" />}
        />
      </Cell>
      <Cell label="Time commitment">
        {f["club.hours_per_week"] ? (
          <div className="font-medium">
            <Fact field={f["club.hours_per_week"]} render={renderHours} />
          </div>
        ) : f["club.meeting_frequency"] ? (
          <Fact field={f["club.meeting_frequency"]} render={(v) => String(v)} />
        ) : (
          <Ask club={club} type="time_commitment" ask="Know it?" />
        )}
      </Cell>
    </dl>
  );
}
