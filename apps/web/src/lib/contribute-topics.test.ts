import { describe, expect, it } from "vitest";
import { CONTRIBUTION_TYPE_DEFS } from "@hci/core";
import { ADDABLE, FIXES, TOPIC_LABEL } from "./contribute-topics";

describe("contribution topics", () => {
  it("offers every form option a profile can use, each with a chip name", () => {
    const offered = new Set([...ADDABLE, ...FIXES, "club_manager", "missing_club"]);
    for (const d of CONTRIBUTION_TYPE_DEFS) expect(offered.has(d.key), d.key).toBe(true);
    for (const t of [...ADDABLE, ...FIXES]) expect(TOPIC_LABEL[t], t).toBeTruthy();
  });
});
