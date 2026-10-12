"use client";

import type { JoinMode, RecruitingSeason } from "@hci/core/browser";
import { announcedLaterRound, withLiveStatus, type CycleSummary } from "@hci/db/local";
import { announcedRoundText } from "@/lib/compare-summary";
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
  joinModes,
}: {
  cycle: CycleSummary;
  seasons?: readonly RecruitingSeason[] | undefined;
  /** How the club's members join: names an announced round's process ("Next auditions"). */
  joinModes?: readonly JoinMode[] | undefined;
}) {
  const now = useNow();
  if (cycle.status === "unknown" && !now) return null;
  if (!now) return <CycleStatusPill cycle={cycle} />;
  const live = withLiveStatus(cycle, now);
  if (live.status === "unknown") {
    // A round the club's own pages announce for a later term, before any date (ADR 0051 amendment).
    return announcedLaterRound([live], now) ? <Pill>{announcedRoundText(live, joinModes)}</Pill> : null;
  }
  if (live.status !== "closed") return <CycleStatusPill cycle={live} />;
  const text = closedRowText(live, seasons, now, (v) => formatDay(v, now));
  return text ? <Pill title={`${formatTerm(live.termKey)} recruiting is over`}>{text}</Pill> : null;
}
