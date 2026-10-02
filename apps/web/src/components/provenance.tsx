import type { Badge } from "@hci/core/browser";
import type { StoredField } from "@hci/db/local";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { describeSource, hostOf, type FactSource } from "@/lib/provenance";
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
    <span className="ml-1.5 text-xs text-stone-500 dark:text-stone-400" title={BADGE_META.community.help}>
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

type Resolved = { value: unknown; claimId: string; badge: Badge; assertionKind: string; sources: FactSource[] };

function SourceLine({ s }: { s: FactSource }) {
  const d = describeSource(s);
  const where = hostOf(s.url) ?? d.where;
  return (
    <li className="min-w-0">
      <span className="text-stone-700 dark:text-stone-300">{d.kind}</span>
      {where ? (
        <>
          {" · "}
          {s.isFixture ? (
            <span>{where}</span>
          ) : (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title ?? undefined}
              className="break-all underline decoration-stone-300 underline-offset-2 hover:decoration-stone-700 dark:decoration-stone-600"
            >
              {where}
            </a>
          )}
        </>
      ) : null}
      {d.checked ? <span className="whitespace-nowrap"> · seen {d.checked}</span> : null}
    </li>
  );
}

/** Where one value comes from: its sources, most recent first (at most three). */
function ValueSources({
  v,
  render,
  showValue,
}: {
  v: Resolved;
  render: (value: unknown) => ReactNode;
  showValue: boolean;
}) {
  // One line per site: several pages of the same site say the same thing.
  const bySite = new Map<string, FactSource>();
  for (const src of [...v.sources].sort((a, b) => b.observedAt.localeCompare(a.observedAt))) {
    const key = `${src.sourceType}|${hostOf(src.url) ?? src.url}`;
    if (!bySite.has(key)) bySite.set(key, src);
  }
  const all = [...bySite.values()];
  const sources = all.slice(0, 2);
  return (
    <div className="space-y-0.5">
      {showValue ? <p className="font-medium text-stone-800 dark:text-stone-200">{render(v.value)}</p> : null}
      {sources.length ? (
        <ul className="space-y-0.5">
          {sources.map((s) => (
            <SourceLine key={`${s.url}|${s.observedAt}`} s={s} />
          ))}
          {all.length > sources.length ? <li>and {all.length - sources.length} more (see Sources below)</li> : null}
        </ul>
      ) : (
        <p>Recorded by an hclubs editor.</p>
      )}
      {isCommunity(v) ? <p>Reported by a student; not yet confirmed by a club or Harvard page.</p> : null}
    </div>
  );
}

/**
 * A resolved fact, plain by default and inspectable on demand (ADR 0036): the value is a
 * disclosure that opens to where it came from and when we last saw it there. When sources
 * disagree, it says so and lists the other values (structured fields only; see
 * `publicProfile`). Works without JavaScript.
 */
export function Fact({
  field,
  render,
  unknown = "Unknown",
}: {
  field: StoredField | undefined;
  render: (value: unknown) => ReactNode;
  unknown?: ReactNode;
}) {
  if (!field || (field.kind === "multi" && field.values.length === 0)) return <Unknown>{unknown}</Unknown>;
  const values: Resolved[] = field.kind === "single" ? [field.current] : field.values;
  const alternatives: Resolved[] = field.kind === "single" ? field.alternatives : [];
  const conflict = field.kind === "single" && field.conflict;
  const shown =
    field.kind === "single"
      ? render(field.current.value)
      : values.map((v) => render(v.value)).reduce<ReactNode[]>((acc, n, i) => (i ? [...acc, ", ", n] : [n]), []);
  return (
    <details className="group/fact">
      <summary className="hc-fact-summary">
        {shown}
        {values.some(isCommunity) ? <StudentReported /> : null}
        {conflict ? (
          <span className="ml-1.5 text-xs whitespace-nowrap text-amber-700 dark:text-amber-400">sources differ</span>
        ) : null}
        <span className="sr-only"> (show source)</span>
      </summary>
      <div className="mt-1.5 space-y-2 rounded-md bg-stone-50 px-2.5 py-2 text-xs text-stone-500 dark:bg-stone-900 dark:text-stone-400">
        {values.map((v) => (
          <ValueSources key={v.claimId} v={v} render={render} showValue={values.length > 1} />
        ))}
        {conflict ? (
          <div className="space-y-1.5 border-t border-stone-200 pt-2 dark:border-stone-800">
            <p className="text-stone-600 dark:text-stone-300">
              {alternatives.length ? "Other sources say:" : "Other sources disagree with this value."}
            </p>
            {alternatives.map((v) => (
              <ValueSources key={v.claimId} v={v} render={render} showValue />
            ))}
            <p>
              We show the value from the most reliable, most recent source.{" "}
              <Link href="/about/methodology/#conflicts" className="underline underline-offset-2">
                How we choose
              </Link>
            </p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
