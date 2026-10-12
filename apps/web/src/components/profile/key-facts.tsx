import type { ReactNode } from "react";
import type { RecruitingSeason } from "@hci/core";
import type { ClubProfile } from "@hci/db";
import { announcedLaterRound } from "@hci/db/local";
import { DerivedFact, Fact } from "@/components/provenance";
import { accessText, rolesText } from "@/lib/joining";
import { joinTiming } from "@/lib/join-timing";
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
const COLS = ["", "", "sm:grid-cols-2", "sm:grid-cols-3"] as const;

/** Whether the top-of-profile answers have anything to say. */
export function hasKeyFacts(club: ClubProfile, seasons: readonly RecruitingSeason[]): boolean {
  return Boolean(
    accessText(club.joining) ||
    club.joining.firstYears !== null ||
    club.joining.noExperience ||
    whenKnown(club, seasons) ||
    club.fields["club.hours_per_week"] ||
    club.fields["club.meeting_frequency"],
  );
}

/**
 * The next round the club's own pages announce for a later term, as of the build (the live
 * cell re-checks the term on the reader's day): only its term and process.
 */
export function laterRound(club: Pick<ClubProfile, "cycles">, now: Date = new Date()) {
  const later = announcedLaterRound(club.cycles, now);
  return later ? { termKey: later.termKey, processTypes: later.processTypes } : null;
}

/** "When" has an answer at build time (a round or a usual season). The live cell may refine it. */
function whenKnown(club: ClubProfile, seasons: readonly RecruitingSeason[]): boolean {
  const ref = new Date(club.currentCycle?.deadline?.at ?? club.currentCycle?.opens?.at ?? Date.now());
  return (
    joinTiming(
      {
        cycle: club.currentCycle,
        joining: club.joining,
        seasons,
        joinModes: club.joinModes,
        later: laterRound(club, ref),
      },
      ref,
      null,
    ) !== null
  );
}

/**
 * The answers a student wants in five seconds, right under what the club is: how to join
 * (and whether first-years can), by when, and how much time it takes. Only known answers
 * show, each opening to its sources; the page's closing line asks for the rest.
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
  const cells: ReactNode[] = [];
  if (joinText || who.length) {
    cells.push(
      <Cell key="how" label="How to join">
        {joinText ? (
          <div className="font-medium">
            <DerivedFact basis={j.access ? b.access : b.comp} conflict={j.access === "mixed"}>
              {/* Under "How to join", a bare "No comp" says what isn't, not how. */}
              {j.access === null ? "No comp required" : joinText}
            </DerivedFact>
          </div>
        ) : null}
        {j.access === null && joinText ? <span className={muted}>Per the College directory</span> : null}
        {who.length ? <span className={joinText ? muted : "font-medium"}>{who.join(" · ")}</span> : null}
        {joinText && roles ? <span className={muted}>{roles}</span> : null}
      </Cell>,
    );
  }
  if (whenKnown(club, seasons)) {
    cells.push(
      <Cell key="when" label="When">
        <JoinWhen
          cycle={club.currentCycle}
          joining={j}
          seasons={seasons}
          joinModes={club.joinModes}
          later={laterRound(club)}
          unknown={<span className="text-stone-500 dark:text-stone-400">No date yet</span>}
        />
      </Cell>,
    );
  }
  if (f["club.hours_per_week"] || f["club.meeting_frequency"]) {
    cells.push(
      <Cell key="time" label="Time commitment">
        {f["club.hours_per_week"] ? (
          <div className="font-medium">
            <Fact field={f["club.hours_per_week"]} render={renderHours} />
          </div>
        ) : (
          <Fact field={f["club.meeting_frequency"]} render={(v) => String(v)} />
        )}
      </Cell>,
    );
  }
  if (!cells.length) return null;
  return (
    <dl
      aria-label="Joining at a glance"
      className={`grid max-w-3xl divide-y divide-stone-100 rounded-xl border border-stone-200 sm:divide-x sm:divide-y-0 dark:divide-stone-800 dark:border-stone-800 ${COLS[cells.length]}`}
    >
      {cells}
    </dl>
  );
}
