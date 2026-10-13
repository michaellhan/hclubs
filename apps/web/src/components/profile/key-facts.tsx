import type { ReactNode } from "react";
import type { RecruitingSeason } from "@hci/core";
import { JOIN_MODE_HELP, JOIN_MODE_LABEL } from "@hci/core/browser";
import type { ClubProfile } from "@hci/db";
import { DerivedFact, Fact } from "@/components/provenance";
import { accessText, rolesText } from "@/lib/joining";
import { laterRound, whenKnown } from "@/lib/when-known";
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

/**
 * A first-year's gloss for the process words: "Comp: a few weeks of doing the club's work to
 * join." (the wording of the How to join row). Only comp, audition and tryout need one;
 * null for open membership or an application.
 */
export function processGloss(j: Pick<ClubProfile["joining"], "access" | "general" | "noCuts">): string | null {
  if (j.access !== "process") return null;
  const mode = j.general.find((m) => m === "comp" || m === "audition" || m === "tryout");
  if (!mode) return null;
  const help = mode === "comp" && j.noCuts ? "everyone who completes it becomes a member" : JOIN_MODE_HELP[mode];
  return `${JOIN_MODE_LABEL[mode]}: ${help.charAt(0).toLowerCase()}${help.slice(1)}`;
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
  const gloss = processGloss(j);
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
      <Cell key="how" label="Joining">
        {joinText ? (
          <div className="font-medium">
            <DerivedFact basis={j.access ? b.access : b.comp} conflict={j.access === "mixed"}>
              {/* Under "How to join", a bare "No comp" says what isn't, not how. */}
              {j.access === null ? "No comp required" : joinText}
            </DerivedFact>
          </div>
        ) : null}
        {gloss ? <span className={muted}>{gloss}</span> : null}
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
