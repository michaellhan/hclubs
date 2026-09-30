import { SOURCE_TYPE_LABEL, type Badge, type ResolvedValue } from "@hci/core";
import type { StoredField } from "@hci/db/local";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { Pill, type Tone, Unknown } from "./ui";

/** Single badge vocabulary (CLAUDE.md §7.4). */
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

function SourceList({ value }: { value: ResolvedValue }) {
  return (
    <ul className="space-y-2">
      {value.sources.map((s) => (
        <li key={s.sourceId} className="text-xs leading-5">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{SOURCE_TYPE_LABEL[s.sourceType]}</span>
            {s.isFixture ? (
              <span className="text-amber-700 dark:text-amber-400">demo source</span>
            ) : (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {s.title ?? new URL(s.url).hostname}
              </a>
            )}
          </div>
          <div className="text-zinc-500 dark:text-zinc-400">Observed {formatDate(s.observedAt)}</div>
          {s.quote ? (
            <blockquote className="mt-1 border-l-2 border-zinc-200 pl-2 text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400">
              “{s.quote.length > 220 ? `${s.quote.slice(0, 220)}…` : s.quote}”
            </blockquote>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders a resolved value with its badge and an expandable provenance panel.
 * Every claimable field on the site renders through this component (CLAUDE.md §15).
 */
export function Provenance({
  value,
  alternatives = [],
  conflict = false,
  children,
  align = "left",
}: {
  value: ResolvedValue;
  alternatives?: ResolvedValue[];
  /** True only for factual disagreements; wording variants are shown as "other versions". */
  conflict?: boolean;
  children?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <details className="group relative inline-block">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded outline-offset-2">
        {children}
        <ProvenanceBadge badge={value.badge} stale={value.stale} />
        {conflict ? (
          <Pill tone="amber" title="Sources disagree">
            Conflicting
          </Pill>
        ) : null}
      </summary>
      <div
        className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-2 w-80 max-w-[85vw] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900`}
      >
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          {BADGE_META[value.badge].help}
          {value.asOf ? ` Applies as of ${formatDate(value.asOf)}.` : ""}
        </p>
        <SourceList value={value} />
        {alternatives.length > 0 ? (
          <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              {conflict ? "Other sources say" : "Other versions"}
            </p>
            {alternatives.map((a) => (
              <div key={a.claimId} className="mb-2 text-xs">
                <div className="font-medium">{renderPlain(a.value)}</div>
                <SourceList value={a} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function renderPlain(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object" && v && "kind" in v) {
    const m = v as { kind: string; count?: number; min?: number | null; max?: number | null };
    if (m.kind === "exact") return `${m.count}`;
    if (m.kind === "range") return `${m.min ?? "?"}–${m.max ?? "?"}`;
  }
  return JSON.stringify(v);
}

/** Weakest first: a list shows the least-certain badge among its values (never overstates). */
const BADGE_STRENGTH: Record<Badge, number> = {
  unknown: 0,
  estimate: 1,
  community: 2,
  reported: 3,
  computed: 4,
  verified: 5,
};

/** Field row helper: shows the value with provenance, or an explicit Unknown. */
export function FieldValue({
  field,
  render,
  unknown = "Unknown",
  align = "left",
  summary,
}: {
  field: StoredField | undefined;
  render: (value: unknown) => ReactNode;
  unknown?: ReactNode;
  align?: "left" | "right";
  /** Shown next to the badge instead of the rendered values (when they're rendered elsewhere, e.g. as links). */
  summary?: ReactNode;
}) {
  if (!field) return <Unknown>{unknown}</Unknown>;
  if (field.kind === "single") {
    return (
      <Provenance value={field.current} alternatives={field.alternatives} conflict={field.conflict} align={align}>
        {summary ?? <span>{render(field.current.value)}</span>}
      </Provenance>
    );
  }
  if (field.values.length === 0) return <Unknown>{unknown}</Unknown>;
  // Badge the list by its weakest value; the popover shows each value with its own badge.
  const weakest = field.values.reduce((w, v) => (BADGE_STRENGTH[v.badge] < BADGE_STRENGTH[w.badge] ? v : w));
  return (
    <details className="group relative inline-block">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded outline-offset-2">
        {summary ?? (
          <span>
            {field.values
              .map((v) => render(v.value))
              .reduce<ReactNode[]>((acc, n, i) => (i ? [...acc, ", ", n] : [n]), [])}
          </span>
        )}
        <ProvenanceBadge badge={weakest.badge} stale={weakest.stale} />
      </summary>
      <div
        className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-2 w-80 max-w-[85vw] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900`}
      >
        {field.values.map((v) => (
          <div key={v.claimId} className="mb-3 last:mb-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{render(v.value)}</span>
              <ProvenanceBadge badge={v.badge} stale={v.stale} />
            </div>
            <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">{BADGE_META[v.badge].help}</p>
            <SourceList value={v} />
          </div>
        ))}
      </div>
    </details>
  );
}
