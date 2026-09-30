import type { Badge } from "@hci/core";
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
 * methodology page cover it.
 */
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
  if (field.kind === "single") return <span>{render(field.current.value)}</span>;
  if (field.values.length === 0) return <Unknown>{unknown}</Unknown>;
  return (
    <span>
      {field.values
        .map((v) => <Fragment key={v.claimId}>{render(v.value)}</Fragment>)
        .reduce<ReactNode[]>((acc, n, i) => (i ? [...acc, ", ", n] : [n]), [])}
    </span>
  );
}
