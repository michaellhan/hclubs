import Link from "next/link";
import { LifecycleValue } from "@hci/core";
import type { StoredField } from "@hci/db/local";

/**
 * "This organization ended" notice (ADR 0038), shown only when a source says so (a
 * `club.lifecycle` claim with verified quotes). The page stays up for reference and
 * search; joining actions are hidden by the caller.
 */
export function EndedNotice({
  name,
  field,
  successor,
}: {
  name: string;
  field: StoredField | undefined;
  /** The indexed successor, when the source names one. */
  successor: { slug: string; name: string } | null;
}) {
  if (field?.kind !== "single") return null;
  const parsed = LifecycleValue.safeParse(field.current.value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const source = field.current.sources[0];
  let host: string | null = null;
  try {
    host = source ? new URL(source.url).hostname.replace(/^www\./, "") : null;
  } catch {
    host = null;
  }
  const year = v.year ? ` in ${v.year}` : "";
  const successorName = successor?.name ?? v.successorName;
  return (
    <div
      role="note"
      className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p>
        <strong className="font-semibold">No longer active.</strong> {name}{" "}
        {v.event === "replaced" && successorName ? (
          <>
            was replaced by{" "}
            {successor ? (
              <Link href={`/clubs/${successor.slug}/`} className="font-medium underline underline-offset-2">
                {successorName}
              </Link>
            ) : (
              successorName
            )}
            {year}.
          </>
        ) : (
          <>was dissolved{year}.</>
        )}{" "}
        This page is kept for reference.
      </p>
      {source && host ? (
        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
          Source:{" "}
          <a href={source.url} className="underline underline-offset-2" rel="noopener noreferrer">
            {host}
          </a>
        </p>
      ) : null}
    </div>
  );
}
