import type { ReactNode } from "react";

export type Tone = "neutral" | "accent" | "green" | "amber" | "blue" | "violet" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800/70 dark:text-stone-300 dark:ring-stone-700",
  accent: "bg-accent-soft text-accent ring-accent/25",
  green:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  blue: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  violet:
    "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  muted: "bg-transparent text-stone-500 ring-stone-200 ring-dashed dark:text-stone-400 dark:ring-stone-700",
};

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 ${typeof children === "string" && children.length > 28 ? "" : "whitespace-nowrap"} rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function DemoPill() {
  return (
    <Pill tone="amber" title="Fictional development fixture — not a real organization">
      Demo data
    </Pill>
  );
}

export function SectionHeading({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={id} className="hc-eyebrow">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 px-6 py-12 text-center dark:border-stone-700">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">{children}</div> : null}
    </div>
  );
}

export function Unknown({ children = "Unknown" }: { children?: ReactNode }) {
  return <span className="text-stone-500 dark:text-stone-400">{children}</span>;
}

const FILLER = new Set([
  "the",
  "of",
  "and",
  "for",
  "at",
  "in",
  "on",
  "a",
  "an",
  "to",
  "&",
  "harvard",
  "harvard-radcliffe",
  "radcliffe",
  "undergraduate",
  "undergraduates",
  "college",
  "university",
  "students",
  "student",
  "hc",
  "pbha",
  "club",
  "society",
  "association",
  "organization",
]);

/** Initials avatar used until real logos are sourced (no fabricated imagery). */
export function LogoPlaceholder({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const words = name
    .replace(/\(.*?\)/g, " ")
    .split(/[\s\-:/]+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w) && !FILLER.has(w.toLowerCase().replace(/['’]s$/, "")));
  // "Harvard Undergraduate Moot Court" → "MC"; a lone distinctive word keeps two letters.
  const initials = (
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? name).replace(/[^A-Za-z0-9]/g, "").slice(0, 2)
  ).toUpperCase();
  const dims = { sm: "size-8 text-[11px]", md: "size-10 text-xs", lg: "size-14 text-base" }[size];
  return (
    <div
      aria-hidden
      className={`${dims} flex shrink-0 items-center justify-center rounded-lg bg-stone-100 font-semibold text-stone-600 ring-1 ring-inset ring-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:ring-stone-700`}
    >
      {initials || "•"}
    </div>
  );
}
