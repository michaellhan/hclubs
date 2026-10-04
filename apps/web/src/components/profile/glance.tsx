import type { ReactNode } from "react";
import { CLASS_YEAR_LABEL, RECOGNITION_STATUS_LABEL, type ClassYear } from "@hci/core";
import type { ClubProfile } from "@hci/db";
import { DerivedFact, Fact } from "@/components/provenance";
import { Disclosure } from "./disclosure";
import { renderDues, renderMembers } from "@/lib/render";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const classes = (v: unknown) => (v as ClassYear[]).map((c) => CLASS_YEAR_LABEL[c]).join(", ");
const ALL_UNDERGRAD = ["first_year", "sophomore", "junior", "senior"];

/**
 * "Details": a closed row with the known facts the header's key facts don't already answer
 * (size, dues, who may join, how often it meets…). Nothing unknown is listed; the page's
 * closing line asks for what's missing. Every value opens to its source. Null when empty.
 */
export function AtAGlance({ club, travel }: { club: ClubProfile; travel: string[] }) {
  const f = club.fields;
  const j = club.joining;
  const b = club.joiningBasis;
  const eligible = club.eligibleClasses ?? [];
  // The header answers first-years unless sources differ, and "No experience needed" from this field.
  const showFirstYears = j.conflicts.includes("firstYears");
  const showExperience = Boolean(f["club.experience_required"]) && !j.noExperience;
  const showMeets = Boolean(f["club.meeting_frequency"]) && Boolean(f["club.hours_per_week"]);
  const showClasses = eligible.length > 0 && !ALL_UNDERGRAD.every((c) => eligible.includes(c));
  const rows = [
    club.recognitionStatus !== "unknown" ? (
      <Row key="status" label="Status">
        {RECOGNITION_STATUS_LABEL[club.recognitionStatus]}
      </Row>
    ) : null,
    showFirstYears ? (
      <Row key="fy" label="First-years">
        <DerivedFact basis={b.firstYears} conflict>
          {j.firstYears === true ? "Eligible" : j.firstYears === false ? "Not eligible" : "Unclear"}
        </DerivedFact>
      </Row>
    ) : null,
    showClasses ? (
      <Row key="classes" label="Open to">
        <Fact field={f["club.eligible_classes"]} render={classes} />
      </Row>
    ) : null,
    f["club.member_count"] ? (
      <Row key="members" label="Members">
        <Fact field={f["club.member_count"]} render={renderMembers} />
      </Row>
    ) : null,
    f["club.dues"] ? (
      <Row key="dues" label="Dues">
        <Fact field={f["club.dues"]} render={renderDues} />
      </Row>
    ) : null,
    showMeets ? (
      <Row key="meets" label="Meets">
        <Fact field={f["club.meeting_frequency"]} render={(v) => String(v)} />
      </Row>
    ) : null,
    showExperience ? (
      <Row key="exp" label="Experience">
        <Fact field={f["club.experience_required"]} render={(v) => String(v)} />
      </Row>
    ) : null,
    f["club.eligibility_note"] ? (
      <Row key="elig" label="Eligibility">
        <Fact field={f["club.eligibility_note"]} render={(v) => String(v)} />
      </Row>
    ) : null,
    travel.length ? (
      <Row key="travel" label="Travel">
        {travel.join(", ")}
      </Row>
    ) : null,
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <Disclosure id="at-a-glance" title="Details">
      <dl className="divide-y divide-stone-100 dark:divide-stone-800">{rows}</dl>
    </Disclosure>
  );
}
