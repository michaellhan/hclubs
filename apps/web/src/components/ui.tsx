import type { ReactNode } from "react";

export type Tone = "neutral" | "accent" | "green" | "amber" | "blue" | "violet" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800/70 dark:text-zinc-300 dark:ring-zinc-700",
  accent: "bg-accent-soft text-accent ring-accent/20 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  green:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  blue: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  violet:
    "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  muted: "bg-transparent text-zinc-500 ring-zinc-200 ring-dashed dark:text-zinc-400 dark:ring-zinc-700",
};

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ${TONES[tone]}`}
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

export function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{children}</div> : null}
    </div>
  );
}

export function Unknown({ children = "Unknown" }: { children?: ReactNode }) {
  return <span className="text-zinc-400 dark:text-zinc-500">{children}</span>;
}

/** Initials avatar used until real logos are sourced (no fabricated imagery). */
export function LogoPlaceholder({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .replace(/^the\s+/i, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w) && !["of", "and", "for", "the"].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const dims = { sm: "size-8 text-[11px]", md: "size-10 text-xs", lg: "size-14 text-base" }[size];
  return (
    <div
      aria-hidden
      className={`${dims} flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 font-semibold text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700`}
    >
      {initials || "•"}
    </div>
  );
}
