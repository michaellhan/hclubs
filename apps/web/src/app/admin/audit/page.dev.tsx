import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findRepoRoot } from "@hci/db";
import { Pill, SectionHeading } from "@/components/ui";
import { adminEnabled } from "@/lib/admin";

// Development only: the file extension keeps it out of the static export (next.config.ts).
// Reads the latest `pnpm hci audit` report (data/reports/audit.json); read-only (ADR 0033).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data audit (dev)", robots: { index: false, follow: false } };

interface Finding {
  check: string;
  area: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  slug: string | null;
  subject: string;
  detail: string;
  displayed: boolean;
  fix: { kind: string } | null;
}
interface Report {
  version: string;
  generatedAt: string;
  metrics: Record<string, unknown> & { completeness: Record<string, number> };
  findings: Finding[];
  applied: { claimsRejected: number; clubsMerged: string[]; clubsReResolved: number } | null;
}

const SEVERITY_TONE = { critical: "accent", high: "amber", medium: "neutral", low: "muted" } as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ area?: string; sev?: string }> }) {
  if (!adminEnabled()) notFound();
  const { area, sev } = await searchParams;
  const path = join(findRepoRoot(), "data", "reports", "audit.json");
  if (!existsSync(path))
    return (
      <p className="text-sm text-zinc-500">
        No report yet. Run <code>pnpm hci audit</code>.
      </p>
    );
  const report = JSON.parse(readFileSync(path, "utf8")) as Report;
  const areas = [...new Set(report.findings.map((f) => f.area))].sort();
  const shown = report.findings.filter((f) => (!area || f.area === area) && (!sev || f.severity === sev)).slice(0, 500);
  const href = (q: { area?: string | undefined; sev?: string | undefined }) => {
    const p = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
    return `/admin/audit${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data audit</h1>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Development-only, read-only. Report {report.version} from {report.generatedAt.slice(0, 16).replace("T", " ")}.
          Fix with <code>pnpm hci audit --apply</code> (high-confidence findings only).
        </p>
      </div>

      <section>
        <SectionHeading>Health</SectionHeading>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          {Object.entries(report.metrics)
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-zinc-100 py-1 dark:border-zinc-800">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="tabular-nums">{String(v)}</dd>
              </div>
            ))}
        </dl>
        <p className="mt-2 text-xs text-zinc-500">
          Completeness:{" "}
          {Object.entries(report.metrics.completeness)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")}
        </p>
      </section>

      <section>
        <SectionHeading aside={<span className="text-xs text-zinc-500">{shown.length} shown</span>}>
          Findings
        </SectionHeading>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Link href={href({ sev })} className={!area ? "font-semibold underline" : "underline"}>
            all areas
          </Link>
          {areas.map((a) => (
            <Link
              key={a}
              href={href({ area: a, sev })}
              className={area === a ? "font-semibold underline" : "underline"}
            >
              {a}
            </Link>
          ))}
          <span className="text-zinc-400">|</span>
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <Link
              key={s}
              href={href({ area, sev: sev === s ? undefined : s })}
              className={sev === s ? "font-semibold underline" : "underline"}
            >
              {s}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
              <tr>
                {["Severity", "Check", "Club", "Subject", "Detail", "Action"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 align-top dark:divide-zinc-800">
              {shown.map((f, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    <Pill tone={SEVERITY_TONE[f.severity]}>{f.severity}</Pill>
                  </td>
                  <td className="px-2 py-1.5 font-mono">{f.check}</td>
                  <td className="px-2 py-1.5">
                    {f.slug ? (
                      <Link href={`/clubs/${f.slug}`} className="underline">
                        {f.slug}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-xs break-all px-2 py-1.5">{f.subject}</td>
                  <td className="max-w-md px-2 py-1.5">{f.detail}</td>
                  <td className="px-2 py-1.5">
                    {f.fix && f.confidence === "high" ? f.fix.kind.replace("_", " ") : `review (${f.confidence})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
