import { describe, expect, it } from "vitest";
import { missingClubSlug } from "./missing-club";

describe("missingClubSlug", () => {
  it("normalizes case, separators and punctuation the way slugs are written", () => {
    expect(missingClubSlug("/clubs/Harvard-Lampoon/")).toBe("harvard-lampoon");
    expect(missingClubSlug("/clubs/Harvard_Lampoon")).toBe("harvard-lampoon");
    expect(missingClubSlug("/clubs/Harvard%20Din%20%26%20Tonics/")).toBe("harvard-din-and-tonics");
    expect(missingClubSlug("/clubs/PBHA%E2%80%99s-CIVICS")).toBe("pbhas-civics");
    expect(missingClubSlug("/hci/clubs/HCS", "/hci")).toBe("hcs");
  });

  it("ignores other paths and malformed escapes safely", () => {
    expect(missingClubSlug("/categories/dance/")).toBeNull();
    expect(missingClubSlug("/clubs/")).toBeNull();
    expect(missingClubSlug("/clubs/%E0%A4%A")).toBe("e0-a4-a");
  });
});
