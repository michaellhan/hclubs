"use client";

import type { RecruitingSeason } from "@hci/core/browser";
import { withLiveStatus, type CycleSummary } from "@hci/db/local";
import { formatDay, formatTerm } from "@/lib/format";
import { closedRowText } from "@/lib/row-status";
import { useNow } from "@/lib/use-now";
import { CycleStatusPill } from "./club-bits";
import { Pill } from "./ui";

/**
 * The recruiting chip on a directory row, always computed from the viewer's clock (pages and
 * the index are built ahead). Open and upcoming cycles use the shared pill; a recently closed
 * one says when, and when the club usually recruits (from its past pattern) if that differs.
 */
export function RowRecruiting({
  cycle,
  seasons,
}: {
  cycle: CycleSummary;
  seasons?: readonly RecruitingSeason[] | undefined;
}) {
  const now = useNow();
  if (cycle.status === "unknown" && !now) return null;
  if (!now) return <CycleStatusPill cycle={cycle} />;
  const live = withLiveStatus(cycle, now);
  if (live.status === "unknown") return null;
  if (live.status !== "closed") return <CycleStatusPill cycle={live} />;
  const text = closedRowText(live, seasons, now, (v) => formatDay(v, now));
  return text ? <Pill title={`${formatTerm(live.termKey)} recruiting is over`}>{text}</Pill> : null;
}
