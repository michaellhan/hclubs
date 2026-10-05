import type { Badge, JoiningBasis } from "@hci/core/browser";
import type { StoredField } from "@hci/db/local";
import { Fragment, type ReactNode } from "react";
import { Pill, type Tone, Unknown } from "./ui";

/** Badge vocabulary (CLAUDE.md §7.4) — explained on the methodology page, not shown per field. */
export const BADGE_META: Record<Badge, { label: string; tone: Tone; help: string }> = {
  verified: {
    label: "Verified",
    tone: "green",
    help: "Stated by an official Harvard or club source, recently observed.",
  },
  reported: {
    label: "Reported",
    tone: "neutral",
    help: "Stated by a secondary source, or an official source we haven't re-checked recently.",
  },
  community: {
    label: "Community",
    tone: "blue",
    help: "Reported by students; not yet confirmed by an official source.",
  },
  computed: { label: "Computed", tone: "violet", help: "Calculated from sourced numbers." },
  estimate: { label: "Estimate", tone: "amber", help: "Inferred or derived by us — not directly stated by a source." },
  unknown: { label: "Unknown", tone: "muted", help: "No acceptable evidence yet." },
};

export function ProvenanceBadge({ badge, stale }: { badge: Badge; stale?: boolean }) {
  const meta = BADGE_META[badge];
  return (
    <Pill tone={meta.tone} title={meta.help + (stale ? " Last observed a while ago." : "")}>
      {meta.label}
      {stale ? <span aria-label="stale">·old</span> : null}
    </Pill>
  );
}

/**
 * Renders a resolved field's value — just the value. Every claimable field on the site
 * renders through this component (CLAUDE.md §15). Provenance (badges, sources, freshness)
 * is intentionally not shown inline; the profile's collapsed "Sources" section and the
 * methodology page cover it. The one exception: a value only students reported carries a
 * quiet "student-reported" note, so crowdsourced facts never read as official (ADR 0035).
 */
/** Shown only by student submissions: no page we fetched states it. */
const isCommunity = (v: { badge: Badge; assertionKind: string }) =>
  v.badge === "community" || v.assertionKind === "user_reported";

function StudentReported() {
  return (
    <span className="ml-1.5 text-xs text-stone-500 dark:text-stone-400" data-tip={BADGE_META.community.help}>
      (student-reported)
    </span>
  );
}

export function FieldValue({
  field,
  render,
  unknown = "Unknown",
}: {
  field: StoredField | undefined;
  render: (value: unknown) => ReactNode;
  unknown?: ReactNode;
}) {
  if (!field) return <Unknown>{unknown}</Unknown>;
  if (field.kind === "single")
    return (
      <span>
        {render(field.current.value)}
        {isCommunity(field.current) ? <StudentReported /> : null}
      </span>
    );
  if (field.values.length === 0) return <Unknown>{unknown}</Unknown>;
  return (
    <span>
      {field.values
        .map((v) => (
          <Fragment key={v.claimId}>
            {render(v.value)}
            {isCommunity(v) ? <StudentReported /> : null}
          </Fragment>
        ))
        .reduce<ReactNode[]>((acc, n, i) => (i ? [...acc, ", ", n] : [n]), [])}
    </span>
  );
}

/**
 * A resolved fact, shown plainly (owner, 2026-10-05: no tap-to-open source box; the
 * profile's collapsed "Sources" section lists every page). Same output as `FieldValue`,
 * kept as its own name so call sites still mark the profile's key facts.
 */
export function Fact(props: {
  field: StoredField | undefined;
  render: (value: unknown) => ReactNode;
  unknown?: ReactNode;
}) {
  return <FieldValue {...props} />;
}

/**
 * A fact we derived from sourced claims (ADR 0041) — "First-years: eligible" from "open to
 * all Harvard undergraduates" — shown plainly. The rule is explained on /about#joining and
 * the pages it rests on are in the profile's Sources section.
 */
export function DerivedFact({
  children,
}: {
  basis?: JoiningBasis | undefined;
  conflict?: boolean;
  children: ReactNode;
}) {
  return <span>{children}</span>;
}
