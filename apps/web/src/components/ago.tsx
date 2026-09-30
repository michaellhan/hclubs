"use client";

import { formatDate, relativeDays } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** "3 days ago" computed in the viewer's browser; the absolute date until then. */
export function Ago({ iso, fallback = "—" }: { iso: string | null | undefined; fallback?: string }) {
  const now = useNow();
  if (!iso) return <>{fallback}</>;
  return (
    <time dateTime={iso} title={formatDate(iso) ?? undefined}>
      {now ? relativeDays(iso, now) : formatDate(iso)}
    </time>
  );
}
