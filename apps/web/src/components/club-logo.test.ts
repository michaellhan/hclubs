import { describe, expect, it } from "vitest";
import { logoSrc } from "./club-logo";

describe("logoSrc", () => {
  it("asks image CDNs for a small rendition and leaves other hosts alone", () => {
    expect(logoSrc("https://images.squarespace-cdn.com/content/v1/a/logo.png")).toBe(
      "https://images.squarespace-cdn.com/content/v1/a/logo.png?format=300w",
    );
    expect(logoSrc("https://i0.wp.com/hrcm.org/wp-content/uploads/Logo.png?fit=350%2C100&ssl=1")).toBe(
      "https://i0.wp.com/hrcm.org/wp-content/uploads/Logo.png?ssl=1&w=300",
    );
    expect(logoSrc("https://cdn.sanity.io/images/x/production/abc.png")).toBe(
      "https://cdn.sanity.io/images/x/production/abc.png?w=300",
    );
    expect(logoSrc("https://harvardgleeclub.org/wp-content/uploads/logo.png")).toBe(
      "https://harvardgleeclub.org/wp-content/uploads/logo.png",
    );
  });
});
