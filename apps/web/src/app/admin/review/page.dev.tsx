import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getReviewQueue } from "@hci/db";
import { Pill, SectionHeading } from "@/components/ui";
import { adminEnabled } from "@/lib/admin";
import { db } from "@/lib/db";
import { relativeDays } from "@/lib/format";
import { confirmMerge, rejectCandidate, undo } from "./actions";

// Development only: the file extension keeps it out of the static export (next.config.ts).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review (dev)", robots: { index: false, follow: false } };

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 align-top dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  );
}
const td = "px-2 py-1.5";
const btn =
  "rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export default async function ReviewPage() {
  if (!adminEnabled()) notFound();
  const q = await getReviewQueue(db());
  const now = new Date();
  const clubLink = (c: { slug: string; name: string } | null) =>
    c ? (
      <Link href={`/clubs/${c.slug}`} className="underline">
        {c.name}
      </Link>
    ) : (
      "—"
    );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data review</h1>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Development-only tool (no auth). Actions are logged in editorial_decision and reversible.
        </p>
      </div>

      <section>
        <SectionHeading aside={<span className="text-xs text-zinc-400">{q.candidates.length} open</span>}>
          Duplicate candidates
        </SectionHeading>
        <Table head={["A", "B", "Score", "Reason", "Why", "Actions"]}>
          {q.candidates.map((c) => (
            <tr key={c.id}>
              <td className={td}>
                {clubLink(c.a)}
                <div className="text-zinc-400">{c.a?.sources} sources</div>
              </td>
              <td className={td}>
                {clubLink(c.b)}
                <div className="text-zinc-400">{c.b?.sources} sources</div>
              </td>
              <td className={`${td} tabular`}>{c.score.toFixed(2)}</td>
              <td className={td}>
                <Pill tone={c.reason === "ambiguous" ? "amber" : "neutral"}>{c.reason}</Pill>
              </td>
              <td className={`${td} max-w-md text-zinc-500`}>{c.explanation}</td>
              <td className={`${td} whitespace-nowrap`}>
                <form action={confirmMerge} className="inline">
                  <input type="hidden" name="absorbed" value={c.clubBId} />
                  <input type="hidden" name="survivor" value={c.clubAId} />
                  <button className={btn} title="Merge B into A">
                    B→A
                  </button>
                </form>{" "}
                <form action={confirmMerge} className="inline">
                  <input type="hidden" name="absorbed" value={c.clubAId} />
                  <input type="hidden" name="survivor" value={c.clubBId} />
                  <button className={btn} title="Merge A into B">
                    A→B
                  </button>
                </form>{" "}
                <form action={rejectCandidate} className="inline">
                  <input type="hidden" name="candidate" value={c.id} />
                  <button className={btn}>Different</button>
                </form>
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <SectionHeading>Recent merges (undoable)</SectionHeading>
        <Table head={["A", "B", "Decided", "By", "Undo"]}>
          {q.recentMerges.map((m) => {
            const absorbed = m.a?.state === "merged" ? m.a : m.b;
            return (
              <tr key={m.id}>
                <td className={td}>{m.a?.name}</td>
                <td className={td}>{m.b?.name}</td>
                <td className={td}>{m.decidedAt ? relativeDays(m.decidedAt.toISOString(), now) : "—"}</td>
                <td className={td}>{m.decidedBy}</td>
                <td className={td}>
                  {absorbed ? (
                    <form action={undo}>
                      <input type="hidden" name="club" value={absorbed.id} />
                      <button className={btn}>Undo</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
      </section>

      <section>
        <SectionHeading>Unresolved candidates (likely duplicate / ambiguous)</SectionHeading>
        <Table head={["Listed as", "Source", "Resolution", "Score", "Created club", "Explanation"]}>
          {q.unresolved.map((u) => (
            <tr key={u.id}>
              <td className={td}>{u.rawName}</td>
              <td className={td}>{u.source}</td>
              <td className={td}>{u.resolution}</td>
              <td className={`${td} tabular`}>{u.score?.toFixed(2)}</td>
              <td className={td}>
                {u.clubSlug ? (
                  <Link href={`/clubs/${u.clubSlug}`} className="underline">
                    {u.clubSlug}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className={`${td} max-w-md text-zinc-500`}>{u.explanation}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <SectionHeading>Suspicious / unconfirmed links</SectionHeading>
        <Table head={["Club", "Kind", "URL", "Status", "Conf.", "Via", "Signals"]}>
          {q.suspiciousLinks.map((l, i) => (
            <tr key={i}>
              <td className={td}>
                <Link href={`/clubs/${l.clubSlug}`} className="underline">
                  {l.clubName}
                </Link>
              </td>
              <td className={td}>{l.kind}</td>
              <td className={`${td} max-w-xs truncate`}>
                <a href={l.url} className="underline" target="_blank" rel="noopener noreferrer">
                  {l.url}
                </a>
              </td>
              <td className={td}>{l.status}</td>
              <td className={`${td} tabular`}>{l.confidence.toFixed(2)}</td>
              <td className={td}>{l.via.join(", ")}</td>
              <td className={`${td} text-zinc-500`}>{l.signals.join("; ")}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <SectionHeading>Low-confidence claims (&lt; 0.5)</SectionHeading>
        <Table head={["Club", "Field", "Value", "Conf.", "Method", "Quote"]}>
          {q.lowConfidence.map((c, i) => (
            <tr key={i}>
              <td className={td}>
                <Link href={`/clubs/${c.clubSlug}`} className="underline">
                  {c.clubSlug}
                </Link>
              </td>
              <td className={td}>{c.field}</td>
              <td className={`${td} max-w-xs truncate`}>{JSON.stringify(c.value)}</td>
              <td className={`${td} tabular`}>{c.confidence.toFixed(2)}</td>
              <td className={td}>{c.method}</td>
              <td className={`${td} max-w-sm truncate text-zinc-500`}>{c.quote}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <SectionHeading>Conflicting claims</SectionHeading>
        <Table head={["Club", "Fields in conflict"]}>
          {q.conflicts.map((c) => (
            <tr key={c.slug}>
              <td className={td}>
                <Link href={`/clubs/${c.slug}`} className="underline">
                  {c.name}
                </Link>
              </td>
              <td className={td}>{c.fields.join(", ")}</td>
            </tr>
          ))}
        </Table>
      </section>

      <section>
        <SectionHeading>Recent ingestion runs</SectionHeading>
        <Table head={["Started", "Job", "Adapter", "Status", "Counters", "Errors"]}>
          {q.runs.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap`}>{relativeDays(r.startedAt.toISOString(), now)}</td>
              <td className={td}>{r.job}</td>
              <td className={td}>{r.adapter}</td>
              <td className={td}>
                <Pill
                  tone={
                    r.status === "succeeded"
                      ? "green"
                      : r.status === "partial"
                        ? "amber"
                        : r.status === "failed"
                          ? "accent"
                          : "neutral"
                  }
                >
                  {r.status}
                </Pill>
              </td>
              <td className={`${td} max-w-md font-mono text-[10px] text-zinc-500`}>{JSON.stringify(r.counters)}</td>
              <td className={`${td} max-w-xs whitespace-pre-wrap text-zinc-500`}>
                {(r.errorSummary ?? "").slice(0, 400)}
              </td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
