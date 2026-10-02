import { describe, expect, it } from "vitest";
import { planContributions } from "./contribute-topics";

describe("planContributions", () => {
  it("shows the three most valuable gaps in priority order", () => {
    const p = planContributions(["dues", "website", "deadline", "joining_process", "instagram"]);
    expect(p.primary).toEqual(["joining_process", "deadline", "website"]);
    expect(p.moreAdds).toEqual(["dues", "instagram"]);
  });
  it("offers a missing link once", () => {
    const p = planContributions(["website"]);
    expect(p.primary).toEqual(["website"]);
    expect(p.fixes).not.toContain("website");
    expect(planContributions([]).fixes).toContain("website");
  });
});
