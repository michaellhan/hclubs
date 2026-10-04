import type { ReactNode } from "react";
import {
  AFFILIATION_SCOPE_LABEL,
  CLASS_YEAR_LABEL,
  ORG_TYPE_LABEL,
  RECOGNITION_STATUS_LABEL,
  type AffiliationScope,
  type ClassYear,
  type ContributionType,
} from "@hci/core";
import type { ClubProfile } from "@hci/db";
import { DerivedFact, Fact } from "@/components/provenance";
import { ContributeLink } from "@/components/suggest-update";
import { Disclosure } from "./disclosure";
import { accessText, rolesText } from "@/lib/joining";
import { renderDues, renderHours, renderMembers } from "@/lib/render";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** A fact nobody has published yet: says so plainly and asks for it. Never looks like "no". */
function NotKnown({ club, type, ask, why }: { club: ClubProfile; type: ContributionType; ask: string; why: string }) {
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
      <span className="block text-xs">{why}</span>
    </span>
  );
}

/**
 * Why a fact is unknown, as precisely as the sources allow (ADR 0040). When the club's own
 * website is confirmed and its pages were read, the fact is "not stated" there; otherwise no
 * source has been found. Never implies the whole web was searched.
 */
export function unknownReason(club: Pick<ClubProfile, "sources" | "links">): string {
  const site = club.links.find((l) => l.kind === "website" && l.status === "verified");
  const read = club.sources.some((s) => s.sourceType === "club_website");
  if (site && read) {
    let host = "its website";
    try {
      host = new URL(site.url).hostname.replace(/^www\./, "");
    } catch {
      /* keep the generic name */
    }
    return `Not stated on the ${host} pages we've read`;
  }
  return "No source we've found says yet";
}

const classes = (v: unknown) => (v as ClassYear[]).map((c) => CLASS_YEAR_LABEL[c]).join(", ");
const ALL_UNDERGRAD = ["first_year", "sophomore", "junior", "senior"];

/**
 * "At a glance" (or "Details" beside the header's key facts, see `compact`): the facts a
 * student checks first, always in the same order. Without key facts, Joining always
 * shows — as "Unknown" with a prefilled way to add it and why it's unknown. The other core
 * facts (first-years, time, size, dues) show when known; the unknown ones share one "Not known
 * yet" line with a link each, so a missing fact never reads as a "no" and a sparse profile
 * isn't a wall of "Unknown" (ADR 0040, amending 0036). Every known value opens to its source.
 */
export function AtAGlance({
  club,
  travel,
  compact = false,
  collapsed = false,
}: {
  club: ClubProfile;
  travel: string[];
  /**
   * The header's key facts already answer joining, first-years, when and time: show only the
   * rest, titled "Details", and nothing at all when there is no rest.
   */
  compact?: boolean;
  /** As a closed "Details" row; no card or footer. */
  collapsed?: boolean;
}) {
  const f = club.fields;
  const j = club.joining;
  const b = club.joiningBasis;
  const eligible = club.eligibleClasses ?? [];
  const otherAffiliation = club.affiliationScope !== "unknown" && club.affiliationScope !== "harvard_college";
  // Derived from every sourced statement (ADR 0041): "open to all undergraduates" counts.
  const joinText = accessText(j);
  const joinKnown = joinText !== null;
  const firstYearsKnown = j.firstYears !== null || j.conflicts.includes("firstYears");
  const known = [joinKnown, firstYearsKnown, f["club.hours_per_week"], f["club.member_count"], f["club.dues"]].filter(
    Boolean,
  ).length;
  const why = unknownReason(club);
  const roles = rolesText(j);
  // The less urgent unknowns share one line, in the order students ask about them.
  const missing: { type: ContributionType; label: string }[] = [
    ...(firstYearsKnown ? [] : [{ type: "eligibility" as const, label: "first-year eligibility" }]),
    // In compact mode the header asks for hours only when it shows nothing for time at all.
    ...(f["club.hours_per_week"] || (compact && !f["club.meeting_frequency"])
      ? []
      : [{ type: "time_commitment" as const, label: "time commitment" }]),
    ...(f["club.member_count"] ? [] : [{ type: "member_count" as const, label: "size" }]),
    ...(f["club.dues"] ? [] : [{ type: "dues" as const, label: "dues" }]),
  ];
  // In compact mode the first-years answer is in the header unless sources differ.
  const showFirstYears = firstYearsKnown && (!compact || j.conflicts.includes("firstYears"));
  // The header's "No experience needed" comes from this same field.
  const showExperience = Boolean(f["club.experience_required"]) && !(compact && j.noExperience);
  const showMeets = Boolean(f["club.meeting_frequency"]) && (!compact || Boolean(f["club.hours_per_week"]));
  if (compact) {
    const rest = [
      club.orgType,
      club.recognitionStatus !== "unknown",
      showFirstYears,
      eligible.length && !ALL_UNDERGRAD.every((c) => eligible.includes(c)),
      f["club.member_count"],
      f["club.dues"],
      showMeets,
      showExperience,
      f["club.eligibility_note"],
      travel.length,
      otherAffiliation,
    ].some(Boolean);
    if (!rest && (club.isFixture || missing.length === 0)) return null;
  }
  // Nothing known yet: one honest line instead of five "Unknown" rows.
  if (known === 0 && !club.isFixture && !compact)
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-4 text-sm dark:border-stone-700">
        <h2 className="mb-1 text-[13px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          At a glance
        </h2>
        <p className="text-stone-600 dark:text-stone-400">
          Not known yet: how to join, who can join, the time commitment, size or dues.
          <span className="block text-xs">{unknownReason(club)}</span>
        </p>
        <p className="mt-2">
          <ContributeLink
            club={{ name: club.name, slug: club.slug }}
            type="joining_process"
            className="font-medium text-stone-900 underline decoration-stone-400 underline-offset-2 dark:text-stone-100"
          >
            Know how to join?
          </ContributeLink>
          {" · "}
          <a href="#improve" className="text-stone-600 underline underline-offset-2 dark:text-stone-400">
            Something wrong?
          </a>
        </p>
      </div>
    );
  const body = (
    <>
      <dl className="divide-y divide-stone-100 dark:divide-stone-800">
        {club.orgType ? <Row label="Type">{ORG_TYPE_LABEL[club.orgType]}</Row> : null}
        {club.recognitionStatus !== "unknown" ? (
          <Row label="Status">{RECOGNITION_STATUS_LABEL[club.recognitionStatus]}</Row>
        ) : null}
        {compact ? null : (
          <Row label="Joining">
            {joinKnown ? (
              <>
                <DerivedFact basis={j.access ? b.access : b.comp} conflict={j.access === "mixed"}>
                  {joinText}
                </DerivedFact>
                {j.access === null ? (
                  <span className="block text-xs text-stone-500 dark:text-stone-400">
                    Per the College&apos;s directory. There may still be an application or audition.
                  </span>
                ) : j.access === "process" && j.comp === false ? (
                  <span className="block text-xs text-stone-500 dark:text-stone-400">
                    No comp, per the College&apos;s directory
                  </span>
                ) : null}
                {roles ? <span className="block text-xs text-stone-500 dark:text-stone-400">{roles}</span> : null}
              </>
            ) : (
              <NotKnown club={club} type="joining_process" ask="Know how to join?" why={why} />
            )}
          </Row>
        )}
        {showFirstYears ? (
          <Row label="First-years">
            <DerivedFact basis={b.firstYears} conflict={j.conflicts.includes("firstYears")}>
              {j.firstYears === true ? "Eligible" : j.firstYears === false ? "Not eligible" : "Unclear"}
            </DerivedFact>
          </Row>
        ) : null}
        {eligible.length && !ALL_UNDERGRAD.every((c) => eligible.includes(c)) ? (
          <Row label="Open to">
            <Fact field={f["club.eligible_classes"]} render={classes} />
          </Row>
        ) : null}
        {f["club.hours_per_week"] && !compact ? (
          <Row label="Time">
            <Fact field={f["club.hours_per_week"]} render={renderHours} />
          </Row>
        ) : null}
        {f["club.member_count"] ? (
          <Row label="Members">
            <Fact field={f["club.member_count"]} render={renderMembers} />
          </Row>
        ) : null}
        {f["club.dues"] ? (
          <Row label="Dues">
            <Fact field={f["club.dues"]} render={renderDues} />
          </Row>
        ) : null}
        {showMeets ? (
          <Row label="Meets">
            <Fact field={f["club.meeting_frequency"]} render={(v) => String(v)} />
          </Row>
        ) : null}
        {showExperience ? (
          <Row label="Experience">
            <Fact field={f["club.experience_required"]} render={(v) => String(v)} />
          </Row>
        ) : null}
        {f["club.eligibility_note"] ? (
          <Row label="Eligibility">
            <Fact field={f["club.eligibility_note"]} render={(v) => String(v)} />
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
      {missing.length && !club.isFixture ? (
        <p className="mt-1 border-t border-stone-100 pt-2 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
          Not known yet:{" "}
          {missing.map((m, i) => (
            <span key={m.type}>
              {i ? ", " : ""}
              <ContributeLink club={{ name: club.name, slug: club.slug }} type={m.type} className="hc-link-muted">
                {m.label}
              </ContributeLink>
            </span>
          ))}
          {joinKnown || compact ? <span className="block text-xs">{why}</span> : null}
        </p>
      ) : null}
    </>
  );
  if (collapsed)
    return (
      <Disclosure id="at-a-glance" title="Details">
        {body}
      </Disclosure>
    );
  return (
    <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
      <h2 className="mb-1 text-[13px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        {compact ? "Details" : "At a glance"}
      </h2>
      {body}
      {club.isFixture ? null : (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 text-[11px] leading-4 text-stone-500 dark:text-stone-400">
          <p>Tap a fact to see where it comes from.</p>
          <a href="#improve" className="hc-chip-text text-xs underline">
            Something wrong? Tell us
          </a>
        </div>
      )}
    </div>
  );
}
