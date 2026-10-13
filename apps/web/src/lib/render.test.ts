import { describe, expect, it } from "vitest";
import { renderDues } from "./render";

describe("renderDues", () => {
  it("says what the amount covers when the source does (the Outing Club, 2026-10-13)", () => {
    expect(renderDues({ hasDues: true, amountUsd: 20, period: "6 months" })).toBe("$20 per 6 months");
    expect(renderDues({ hasDues: true, amountUsd: 20 })).toBe("$20 dues");
    expect(renderDues({ hasDues: false })).toBe("No dues required");
    expect(renderDues({ hasDues: true, amountUsd: null })).toBe("Dues (amount not stated)");
  });
});
