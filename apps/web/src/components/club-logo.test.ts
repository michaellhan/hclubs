import { describe, expect, it } from "vitest";
import { logoSrc } from "./club-logo";

describe("logoSrc", () => {
  it("upgrades http addresses to https", () => {
    expect(logoSrc("http://static1.squarespace.com/static/a/logo.png")).toBe(
      "https://static1.squarespace.com/static/a/logo.png?format=300w",
    );
    expect(logoSrc("http://example.org/logo.png")).toBe("https://example.org/logo.png");
  });

  it("asks image CDNs for a small rendition and leaves other hosts alone", () => {
    expect(logoSrc("https://images.squarespace-cdn.com/content/v1/a/logo.png")).toBe(
      "https://images.squarespace-cdn.com/content/v1/a/logo.png?format=300w",
    );
    expect(logoSrc("https://images.squarespace-cdn.com/content/v1/a/logo.png?format=1500w")).toBe(
      "https://images.squarespace-cdn.com/content/v1/a/logo.png?format=300w",
    );
    expect(logoSrc("https://i0.wp.com/hrcm.org/wp-content/uploads/Logo.png?fit=350%2C100&ssl=1")).toBe(
      "https://i0.wp.com/hrcm.org/wp-content/uploads/Logo.png?ssl=1&w=300",
    );
    expect(logoSrc("https://cdn.sanity.io/images/x/production/abc.png")).toBe(
      "https://cdn.sanity.io/images/x/production/abc.png?w=300",
    );
    const wix = "f3769f_0953518e8bb242d19ae69816621264e4~mv2.png";
    expect(logoSrc(`https://static.wixstatic.com/media/${wix}`)).toBe(
      `https://static.wixstatic.com/media/${wix}/v1/fit/w_300,h_300,q_90,enc_auto/${wix}`,
    );
    // Already a rendition: left as it is.
    expect(logoSrc(`https://static.wixstatic.com/media/${wix}/v1/fill/w_69,h_25/a.png`)).toBe(
      `https://static.wixstatic.com/media/${wix}/v1/fill/w_69,h_25/a.png`,
    );
    // Instagram addresses expire: our own copy is served instead.
    expect(logoSrc("https://scontent-lga3-1.cdninstagram.com/v/t51.2885-19/106127586_2729706_n.jpg")).toBe(
      "/logos/ig/106127586_2729706_n.webp",
    );
    expect(logoSrc("https://harvardgleeclub.org/wp-content/uploads/logo.png")).toBe(
      "https://harvardgleeclub.org/wp-content/uploads/logo.png",
    );
  });
});
