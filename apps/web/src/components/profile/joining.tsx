import type { ReactNode } from "react";
import {
  JOIN_MODE_HELP,
  JOIN_MODE_LABEL,
  RECRUITING_SEASON_LABEL,
  JOIN_ROLE_LABEL,
  STAGE_KIND_LABEL,
  opensAfterDeadline,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core";
import type { ClubProfile, CycleDetail, StageDisplay } from "@hci/db";
import { labelSaysKind } from "@/lib/stage-label";
import { CycleStatusPill } from "@/components/club-bits";
import { Fact, FieldValue } from "@/components/provenance";
import { SectionHeading, ShowMoreSummary } from "@/components/ui";
import { formatDateValue, formatTerm } from "@/lib/format";
import { splitCycles } from "@/lib/cycle-history";
import { hostOf } from "@/lib/provenance";
import { Disclosure } from "./disclosure";
import { OpensRow, RelativeDate } from "./joining-live";

export function renderSeasons(v: unknown): string {
  return (Array.isArray(v) ? v : [])
    .map((s) => RECRUITING_SEASON_LABEL[s as RecruitingSeason] ?? null)
    .filter((s): s is string => s !== null)
    .join(" and ");
}

const capitalize = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function ExternalLink({ href, fixture, children }: { href: string; fixture: boolean; children: ReactNode }) {
  if (fixture)
    return (
      <span className="text-stone-500" data-tip="Demo link — fixture data does not point anywhere real">
        {children}
      </span>
    );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hc-link">
      {children}
    </a>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Whether a cycle has anything to show: a date, status, process, stages, link, counts or eligibility. */
export function cycleHasContent(c: CycleDetail): boolean {
  return Boolean(
    c.opens ||
    c.deadline ||
    c.statedStatus ||
    c.processTypes.length ||
    c.stages.length ||
    c.applicationUrl ||
    c.applicants !== null ||
    c.admits !== null ||
    c.eligibleClasses?.length,
  );
}

/** The stages as a left-to-right flow (wrapping on phones). Only stages a source lists. */
function StageFlow({ stages, now }: { stages: StageDisplay[]; now: Date }) {
  return (
    <ol aria-label="Stages" className="flex flex-wrap items-stretch gap-1.5 text-sm">
      {stages.map((s, i) => {
        const label = capitalize(s.label ?? STAGE_KIND_LABEL[s.kind]);
        const kind = s.label && s.kind !== "other" && !labelSaysKind(s.label, STAGE_KIND_LABEL[s.kind]);
        return (
          <li key={s.ordinal} className="flex items-center gap-1.5">
            <span className="rounded-lg border border-stone-200 px-2.5 py-1.5 dark:border-stone-700">
              <span className="block leading-5 font-medium">{label}</span>
              {kind || s.startsAt || s.endsAt ? (
                <span className="tabular block text-xs text-stone-500 dark:text-stone-400">
                  {kind ? STAGE_KIND_LABEL[s.kind] : null}
                  {kind && (s.startsAt || s.endsAt) ? " · " : null}
                  {s.startsAt ? formatDateValue(s.startsAt, now) : ""}
                  {s.startsAt && s.endsAt ? "–" : ""}
                  {s.endsAt ? formatDateValue(s.endsAt, now) : ""}
                </span>
              ) : null}
            </span>
            {i < stages.length - 1 ? (
              <span aria-hidden className="text-stone-400">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function CycleCard({
  cycle,
  now,
  fixture,
  hideProcess = false,
  past = false,
}: {
  cycle: CycleDetail;
  now: Date;
  fixture: boolean;
  hideProcess?: boolean;
  /** A round from an earlier term: history, worded in the past tense, never as current. */
  past?: boolean;
}) {
  // `now` is the build time: used only for year display; status is recomputed in the browser.
  const appHost = cycle.applicationUrl ? hostOf(cycle.applicationUrl) : null;
  return (
    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {formatTerm(cycle.termKey)} {past ? "round (past)" : "recruiting"}
          {cycle.track !== "main" ? ` · ${cycle.track.replace(/_/g, " ")}` : ""}
        </h3>
        {cycle.status !== "unknown" ? <CycleStatusPill cycle={cycle} /> : null}
      </div>
      <dl className="mt-2 divide-y divide-stone-100 dark:divide-stone-800">
        {cycle.opens ? (
          <OpensRow cycle={cycle}>
            {opensAfterDeadline({ opensAt: cycle.opens, deadline: cycle.deadline }) ? (
              <span className="block text-xs text-amber-700 dark:text-amber-400">
                Listed after the deadline — the sources disagree, so check the club&apos;s page.
              </span>
            ) : null}
          </OpensRow>
        ) : null}
        {cycle.deadline ? (
          <Row label="Deadline">
            <span className="tabular font-medium">
              {formatDateValue(cycle.deadline, now)}
              {cycle.deadline.label ? ` — ${cycle.deadline.label}` : ""}
            </span>
            <RelativeDate value={cycle.deadline} />
          </Row>
        ) : null}
        {cycle.processTypes.length > 0 && !hideProcess ? (
          <Row label="Process">
            <Fact field={cycle.fields["cycle.process_type"]} render={(v) => JOIN_MODE_LABEL[v as JoinMode]} />
          </Row>
        ) : null}
        {cycle.applicationUrl && appHost ? (
          <Row label="Form">
            <ExternalLink href={cycle.applicationUrl} fixture={fixture}>
              {formatTerm(cycle.termKey)} application
            </ExternalLink>
            <span className="text-stone-500 dark:text-stone-400"> · {appHost}</span>
          </Row>
        ) : null}
      </dl>
      {cycle.stages.length > 0 ? (
        <div className="mt-3">
          <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            {cycle.stages.length === 1 ? "The one stage the club lists" : "Stages the club lists"}
          </p>
          <StageFlow stages={cycle.stages} now={now} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * "How to join": the process in plain words, the current (or latest) recruiting cycle with
 * its stages, and every other cycle on record — patterns are labeled as patterns, never as
 * current dates.
 */
export function HowToJoin({
  club,
  now,
  collapsed = false,
}: {
  club: ClubProfile;
  now: Date;
  /** As a closed row (the header's key facts already give the short answer). */
  collapsed?: boolean;
}) {
  const f = club.fields;
  const j = club.joining;
  const seasonsField = f["club.recruiting_seasons"];
  const hasSeasons = seasonsField?.kind === "single" && renderSeasons(seasonsField.current.value) !== "";
  // A cycle whose every fact was rejected keeps its identity row; it has nothing to show.
  const shown = (c: CycleDetail | null): c is CycleDetail => Boolean(c && cycleHasContent(c));
  // A round from an earlier term is history, never current recruiting: it only appears as
  // "Last round: Spring 2026", collapsed (CLAUDE.md §8). `now` is the build day; profiles are
  // rebuilt on every publish, and the live "When" fact recomputes on the reader's day.
  const {
    current,
    others,
    past: pastRounds,
  } = splitCycles(club.cycles, club.currentCycle as CycleDetail | null, now, shown);
  const lastRound = pastRounds[0] ?? null;
  // How general members join (ADR 0041); processes only for some roles are listed after.
  const modes = club.joinModes;
  const directoryNoComp = j.access === null && j.comp === false;
  if (
    !modes.length &&
    !j.roles.length &&
    // Seasons alone add nothing here: the key facts' "When" already says them.
    !current &&
    !others.length &&
    !pastRounds.length &&
    !directoryNoComp
  )
    return null;
  const body = (
    <>
      {modes.length ? (
        <ul className="mb-3 space-y-1.5 text-sm">
          {modes.map((m) => (
            <li key={m}>
              <span className="font-medium">{JOIN_MODE_LABEL[m]}</span>
              {m === "comp" && j.noCuts ? <span className="font-medium"> (no cuts)</span> : null}
              <span className="text-stone-500 dark:text-stone-400">
                {" "}
                — {m === "comp" && j.noCuts ? "everyone who completes it becomes a member" : JOIN_MODE_HELP[m]}
              </span>
            </li>
          ))}
        </ul>
      ) : directoryNoComp ? (
        <p className="mb-3 text-sm">
          <span className="font-medium">No comp</span>
          <span className="text-stone-500 dark:text-stone-400"> — no comp is needed to join</span>
        </p>
      ) : null}
      {j.access === "mixed" ? (
        <p className="-mt-1 mb-3 text-xs text-amber-800 dark:text-amber-300">
          Sources disagree: one says anyone can join, another describes a selection process. Check the club&apos;s own
          page for which applies to you.
        </p>
      ) : null}
      {j.roles.length ? (
        <p className="-mt-1 mb-3 text-xs text-stone-500 dark:text-stone-400">
          Only for some roles:{" "}
          {[
            ...new Set(j.roles.map((r) => `${JOIN_MODE_LABEL[r.mode].toLowerCase()} for ${JOIN_ROLE_LABEL[r.role]}`)),
          ].join("; ")}
          . General membership doesn&apos;t need it.
        </p>
      ) : null}
      {/* Without a round on record, the key facts' "When" already says this. */}
      {hasSeasons && current ? (
        <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
          Usually recruits in <FieldValue field={seasonsField} render={(v) => renderSeasons(v).toLowerCase()} />.
        </p>
      ) : null}
      {current ? (
        <div className="mb-3">
          <CycleCard cycle={current} now={now} fixture={club.isFixture} hideProcess={Boolean(f["club.join_mode"])} />
        </div>
      ) : null}
      {others.length > 0 ? (
        // Same-term tracks or a later term's round: not history, but not the featured one.
        <details className="group mt-1">
          <ShowMoreSummary
            closed={`${others.length} other ${others.length === 1 ? "round" : "rounds"}: ${[
              ...new Set(others.map((c) => formatTerm(c.termKey))),
            ].join(", ")}`}
            open="Hide"
          />
          <div className="mt-3 space-y-3">
            {others.map((c) => (
              <CycleCard key={c.id} cycle={c} now={now} fixture={club.isFixture} />
            ))}
          </div>
        </details>
      ) : null}
      {lastRound ? (
        <details className="group mt-1">
          <ShowMoreSummary
            closed={`Last round: ${formatTerm(lastRound.termKey)}${
              pastRounds.length > 1 ? ` · ${pastRounds.length - 1} earlier` : ""
            }`}
            open="Hide past rounds"
          />
          <div className="mt-3 space-y-3">
            {pastRounds.map((c) => (
              <CycleCard key={c.id} cycle={c} now={now} fixture={club.isFixture} past />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
  if (collapsed)
    return (
      <Disclosure id="how-to-join" title="How to join">
        {body}
      </Disclosure>
    );
  return (
    <section id="how-to-join" aria-labelledby="how-to-join-heading" className="scroll-mt-20">
      <SectionHeading id="how-to-join-heading">How to join</SectionHeading>
      {body}
    </section>
  );
}
