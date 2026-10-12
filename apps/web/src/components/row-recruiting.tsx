"use client";

import type { JoinMode, RecruitingSeason } from "@hci/core/browser";
import { announcedLaterRound, withLiveStatus, type CycleSummary } from "@hci/db/local";
import { formatDay, formatTerm } from "@/lib/format";
import { rowNextText } from "@/lib/row-status";
import { useNow } from "@/lib/use-now";
import { CycleStatusPill } from "./club-bits";
import { Pill } from "./ui";

/**
 * The recruiting chip on a directory or /saved row, always computed from the viewer's clock
 * (pages and the index are built ahead). Open and upcoming cycles use the shared pill. When
 * there is no live round it says when the last one closed and when the club next recruits
 * (`rowNextText`: the same "next chance" as the profile and compare), so a club listed under
 * "Still time to join" shows why. Nothing is shown when nothing is known.
 */
export function RowRecruiting({
  cycle,
  cycles,
  seasons,
  joinModes,
  openAccess = false,
}: {
  /** The club's current cycle, if it has one. */
  cycle: CycleSummary | null;
  /** All the club's cycles: an announced later round is found among them. */
  cycles?: readonly CycleSummary[] | undefined;
  seasons?: readonly RecruitingSeason[] | undefined;
  /** How the club's members join: names an announced round's process ("Next auditions"). */
  joinModes?: readonly JoinMode[] | undefined;
  /** A source says anyone can join: no round to wait for. */
  openAccess?: boolean;
}) {
  const now = useNow();
  if (!now) return cycle && cycle.status !== "unknown" ? <CycleStatusPill cycle={cycle} /> : null;
  const live = cycle ? withLiveStatus(cycle, now) : null;
  if (live && (live.status === "open" || live.status === "deadline_ahead" || live.status === "upcoming"))
    return <CycleStatusPill cycle={live} />;
  const text = rowNextText(
    {
      cycle: live,
      seasons: seasons ?? [],
      openAccess,
      later: announcedLaterRound(cycles ?? (cycle ? [cycle] : []), now),
      joinModes,
    },
    now,
    (v) => formatDay(v, now),
  );
  if (!text) return null;
  return (
    <Pill
      tone={live?.status === "closed" ? "neutral" : "muted"}
      {...(live?.status === "closed" ? { title: `${formatTerm(live.termKey)} recruiting is over` } : {})}
    >
      {text}
    </Pill>
  );
}
