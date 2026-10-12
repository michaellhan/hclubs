import { describe, expect, it } from "vitest";
import { chipName } from "./chip-name";

describe("chipName", () => {
  it("joins label, help and count with single periods", () => {
    expect(chipName("Still time to join", "A round open, or usually in spring.", "6 clubs")).toBe(
      "Still time to join. A round open, or usually in spring. 6 clubs",
    );
  });
  it("works without help or a count", () => {
    expect(chipName("No comp", undefined, null)).toBe("No comp");
    expect(chipName("No comp", undefined, "On. Remove filter")).toBe("No comp. On. Remove filter");
  });
});
