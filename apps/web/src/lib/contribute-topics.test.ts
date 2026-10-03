import { describe, expect, it } from "vitest";
import { CONTRIBUTION_TYPE_DEFS } from "@hci/core";
import { ADDABLE, FIXES, TOPIC_LABEL, planContributions } from "./contribute-topics";

describe("planContributions", () => {
  it("puts the gaps first, in priority order, then every other topic", () => {
    const p = planContributions(["dues", "website", "deadline", "joining_process", "instagram"]);
    expect(p.add.filter((a) => a.missing).map((a) => a.type)).toEqual([
      "joining_process",
      "deadline",
      "dues",
      "website",
      "instagram",
    ]);
    expect(p.add).toHaveLength(ADDABLE.length);
  });

  it("offers every form option a profile can use, each with a chip name", () => {
    const offered = new Set([...ADDABLE, ...FIXES, "club_manager", "missing_club"]);
    for (const d of CONTRIBUTION_TYPE_DEFS) expect(offered.has(d.key), d.key).toBe(true);
    for (const t of [...ADDABLE, ...FIXES]) expect(TOPIC_LABEL[t], t).toBeTruthy();
  });
});
