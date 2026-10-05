import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { logoImageProblem, logoUrlProblem, pickLogo, whiteByName, type ImageMeasure } from "../src/extract/logo";
import { measureImage } from "../src/logo-measure";
import { htmlToDocument } from "../src/parse/document";
import { canonicalImageUrl } from "../src/parse/logo-candidates";

const kinds = (html: string, url = "https://club.test/") =>
  htmlToDocument(html, url).logoCandidates.map((c) => `${c.kind} ${c.url}`);

describe("logo candidates", () => {
  it("finds header logos by their slot, not only by the word 'logo'", () => {
    // Squarespace: the image's own markers say nothing but "nbf-header-logo"; alt is the club's name.
    expect(
      kinds(
        `<title>Harvard Undergraduate Data Analytics Group</title><header id="header"><div class="header-title-logo"><a href="/">
         <img elementtiming="nbf-header-logo-desktop" src="//images.squarespace-cdn.com/content/v1/x/Header.png?format=1500w" alt="Harvard Undergraduate Data Analytics Group"></a></div></header>`,
      ),
    ).toEqual(["header_img https://images.squarespace-cdn.com/content/v1/x/Header.png?format=1500w"]);
    // Bootstrap's navbar-brand wrapper.
    expect(kinds(`<nav class="navbar"><a class="navbar-brand" href="/"><img src="/img/mark.png"></a></nav>`)).toEqual([
      "header_img https://club.test/img/mark.png",
    ]);
    // A home link in the header named like the site.
    expect(
      kinds(
        `<head><meta property="og:site_name" content="THE HARVARD POPS ORCHESTRA"></head><div class="header-inner-wrap"><a href="https://club.test/"><img src="/uploads/top.png" alt="The Harvard Pops Orchestra"></a></div>`,
      ),
    ).toEqual(["header_img https://club.test/uploads/top.png"]);
  });

  it("leaves unmarked header images and body images in logo-ish slots alone or ranked last", () => {
    expect(kinds(`<header><img src="/photo.jpg" alt="Our members at the retreat"></header>`)).toEqual([]);
    expect(kinds(`<main><div class="logos-grid"><img src="/acme.png"></div></main>`)).toEqual([
      "img https://club.test/acme.png",
    ]);
  });

  it("reads srcset when there is no src, and the original of a blurred Wix placeholder", () => {
    expect(kinds(`<header><img srcset="/l-1x.png 1x, /l-2x.png 2x" alt="logo"></header>`)).toEqual([
      "header_img https://club.test/l-2x.png",
    ]);
    const blurred =
      "https://static.wixstatic.com/media/f3769f_0953518e8bb242d19ae69816621264e4~mv2.png/v1/crop/x_2,y_0,w_690,h_251/fill/w_69,h_25,al_c,q_85,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/Harvard_CBE_Logo.png";
    expect(canonicalImageUrl(blurred)).toBe(
      "https://static.wixstatic.com/media/f3769f_0953518e8bb242d19ae69816621264e4~mv2.png",
    );
    expect(kinds(`<header><img src="${blurred}" alt="Harvard_CBE_Logo.png"></header>`)).toEqual([
      "header_img https://static.wixstatic.com/media/f3769f_0953518e8bb242d19ae69816621264e4~mv2.png",
    ]);
  });
});

describe("logo URL rules", () => {
  it("judges a canonical Wix original by the name the page gave it", () => {
    const doc = htmlToDocument(
      `<main><img src="https://static.wixstatic.com/media/02e630_0413~mv2.webp/v1/fill/w_120,h_60/coop_harvard_logo1.webp" alt="logo"></main>`,
      "https://www.crimsondanceteam.com/",
    );
    const [c] = doc.logoCandidates;
    if (!c) throw new Error("no candidate");
    expect(c.url).toBe("https://static.wixstatic.com/media/02e630_0413~mv2.webp");
    expect(logoUrlProblem(c.url, doc.url, c.kind, c.hint)).toMatch(/another organization/);
  });
  it("skips collages and the WordPress.com platform mark", () => {
    const sq = "https://images.squarespace-cdn.com/content/v1/x";
    expect(logoUrlProblem(`${sq}/HUCP%2Blogos%2B%25281%2529.jpg`, "https://hucp.org/", "img")).toMatch(/several/);
    expect(
      logoUrlProblem("https://s-ssl.wordpress.com/i/logo/wpcom-gray-white.png?m=1", "https://club.wordpress.com/"),
    ).not.toBeNull();
  });
  const page = "https://harvardanalytics.org/";
  it("skips template files, screenshots, white variants and third-party widgets", () => {
    for (const url of [
      "http://static1.squarespace.com/static/x/t/y/1597359425719/logo-test.png?format=1500w",
      "https://harvardanalytics.org/uploads/Screen-Shot-2019-06-25-logo.png",
      "https://img.surfing-waves.com/swlogo.png",
      "https://widgets.example.com/brand/logo.png",
    ])
      expect(logoUrlProblem(url, page), url).not.toBeNull();
  });
  it("guesses white variants by name only until the image is measured", () => {
    expect(whiteByName("https://harvardanalytics.org/whitelogotext.png")).toBe(true);
    expect(whiteByName("https://club.test/uploads/logo-large-inverted.png")).toBe(true);
    expect(whiteByName("https://club.test/uploads/logo.png")).toBe(false);
    const c = [{ url: "https://club.test/uploads/logo-large-inverted.png", kind: "header_img" as const, size: null }];
    expect(pickLogo(c, "https://club.test/")).toBeNull();
    expect(pickLogo(c, "https://club.test/", () => ({ ok: true, measure: m(400, 200) }))).not.toBeNull();
  });
  it("lets a site's declared logo slot overrule a screenshot-like file name", () => {
    const url = "https://images.squarespace-cdn.com/content/v1/x/Screen_Shot_2024-04-11.png";
    expect(logoUrlProblem(url, "https://www.harvardcollegedems.org/", "header_img")).toBeNull();
    expect(logoUrlProblem(url, "https://www.harvardcollegedems.org/", "img")).toMatch(/screenshot/);
  });
  it("keeps builder CDNs, the site's own host and Google Sites images", () => {
    for (const url of [
      "https://images.squarespace-cdn.com/content/v1/x/HUCG+Logo+NEW.png",
      "https://static.wixstatic.com/media/abc~mv2.png",
      "https://cdn.harvardanalytics.org/logo.svg",
      "https://lh3.googleusercontent.com/sitesv/abc=w16383",
      "https://hmmt-prod.s3.amazonaws.com/logo.png",
    ])
      expect(logoUrlProblem(url, page), url).toBeNull();
  });
});

const m = (
  width: number,
  height: number,
  stats: Partial<ImageMeasure["stats"]> = {},
  format = "png",
): ImageMeasure => ({
  width,
  height,
  format,
  stats: { opaque: 0.5, dark: 0.6, lumSpread: 0.3, ink: 0.3, ...stats },
});

describe("logo image rules", () => {
  it("rejects what won't read on a small light tile", () => {
    expect(logoImageProblem(m(500, 86, { dark: 0 }))).toMatch(/light/); // white wordmark, transparent
    expect(logoImageProblem(m(32, 32))).toMatch(/small/);
    expect(logoImageProblem(m(72, 72))).toMatch(/small/); // a 72 px app icon blurs at 56 px on retina
    // A pale mark on its own white square: opaque, so not "light", but nothing stands out.
    expect(logoImageProblem(m(600, 600, { opaque: 1, dark: 0, lumSpread: 0.05, ink: 0.01 }))).toMatch(/faint/);
    expect(logoImageProblem(m(1200, 200))).toMatch(/wide/);
    expect(logoImageProblem(m(100, 400))).toMatch(/tall/);
    expect(logoImageProblem(m(300, 300, { opaque: 1, lumSpread: 0 }))).toBe("blank");
  });
  it("accepts dark marks, wordmarks up to about 3:1, a logo on its own white square, and SVGs", () => {
    expect(logoImageProblem(m(693, 251))).toBeNull(); // CBE wordmark, 2.8:1
    expect(logoImageProblem(m(400, 400, { opaque: 1, dark: 0.1, lumSpread: 0.3 }))).toBeNull();
    expect(logoImageProblem(m(24, 24, {}, "svg"))).toBeNull();
  });
});

describe("pickLogo with measurements", () => {
  const sq = "https://images.squarespace-cdn.com/content/v1/x";
  const candidates = [
    { url: `${sq}/Header.png?format=1500w`, kind: "header_img" as const, size: null },
    { url: `${sq}/favicon.ico?format=100w`, kind: "icon" as const, size: null },
  ];
  it("falls back from a white header wordmark to the club's own icon", () => {
    const probe = (url: string) =>
      url.includes("Header")
        ? { ok: true as const, measure: m(1500, 258, { dark: 0 }) }
        : { ok: true as const, measure: m(500, 500, { opaque: 0.4, dark: 0.95 }, "webp") };
    expect(pickLogo(candidates, "https://harvardanalytics.org/", probe)?.candidate.kind).toBe("icon");
  });
  it("prefers a square mark to a wide wordmark of a slightly better kind", () => {
    const c = [
      { url: "https://club.test/wordmark.png", kind: "header_img" as const, size: null },
      { url: "https://club.test/apple.png", kind: "apple_touch_icon" as const, size: 180 },
    ];
    const probe = (url: string) => ({
      ok: true as const,
      measure: url.includes("wordmark") ? m(750, 250) : m(180, 180, { opaque: 1, dark: 0.3 }),
    });
    expect(pickLogo(c, "https://club.test/", probe)?.candidate.url).toBe("https://club.test/apple.png");
  });
  it("needs a measurement for every candidate it uses", () => {
    expect(pickLogo(candidates, "https://harvardanalytics.org/", () => undefined)).toBeNull();
    expect(
      pickLogo(candidates, "https://harvardanalytics.org/", () => ({ ok: false as const, error: "HTTP 404" })),
    ).toBeNull();
  });
});

describe("measureImage", () => {
  it("tells a white mark on transparency from a dark one", async () => {
    const shape = (fill: string) =>
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="20" y="20" width="160" height="60" fill="${fill}"/></svg>`,
      );
    const white = await measureImage(await sharp(shape("#ffffff")).png().toBuffer());
    const dark = await measureImage(await sharp(shape("#123456")).png().toBuffer());
    expect(white).toMatchObject({ width: 200, height: 100, format: "png" });
    expect(logoImageProblem(white)).toMatch(/light/);
    expect(logoImageProblem(dark)).toBeNull();
    const svg = await measureImage(shape("#123456"));
    expect(svg.format).toBe("svg");
    expect(logoImageProblem(svg)).toBeNull();
  });
});

describe("rejected logos", () => {
  it("lets automatic rejections yield to a measured pick, never a reviewer's", async () => {
    const { rejectionYields } = await import("../src/stages/logos");
    expect(rejectionYields("logos", "logo-picker 1.0.0: not the logo …")).toBe(true);
    expect(rejectionYields("cli", "not reproduced after re-running site-deterministic with a newer version")).toBe(
      true,
    );
    expect(rejectionYields("audit", "audit logo.white_only: whitelogotext.png is a white logo")).toBe(true);
    expect(rejectionYields("audit-review", "audit review: logo a generic bicycle icon, not the club's mark")).toBe(
      false,
    );
    expect(rejectionYields("cli", "A 2019 screenshot/photo, not the club's logo (checked 2026-10-02)")).toBe(false);
    expect(rejectionYields("audit", 'audit logo.other_org_mark: "coop_harvard_logo1.webp"')).toBe(false);
    expect(rejectionYields(null, null)).toBe(false);
  });
});

describe("whose logo a body image is", () => {
  it("rejects images named for someone else, keeps the club's and unnamed ones", async () => {
    const { clubNameTokens, namesSomeoneElse } = await import("../src/extract/logo");
    const img = (url: string, hint?: string) => ({ url, kind: "img" as const, size: null, ...(hint ? { hint } : {}) });
    const make = clubNameTokens(["MakeHarvard"], "https://makeharvard.io/");
    expect(
      namesSomeoneElse(img("https://makeharvard.io/static/biogenlogo-3142efb964cf5a080802aec227a1359e.png"), make),
    ).toBe(true);
    const hudc = clubNameTokens(["Harvard Undergraduate Design Collective", "HUDC"], "https://hudc.carrd.co/");
    expect(
      namesSomeoneElse(
        img("https://hudc.carrd.co/assets/images/gallery01/aef68dd7.jpg", "The YX Foundation logo"),
        hudc,
      ),
    ).toBe(true);
    const ea = clubNameTokens(["Harvard Undergraduate Effective Altruism"], "https://www.harvardea.org/");
    expect(namesSomeoneElse(img("https://images.squarespace-cdn.com/content/v1/x/huea_logo-sq.png"), ea)).toBe(false);
    const hbc = clubNameTokens(["Harvard Undergraduate Biotechnology Club"], "https://www.harvardbiotechclub.com/");
    expect(
      namesSomeoneElse(img("https://cdn.test/HBC+logo%2C+HCBC+wording+%28transparent+background%29.png"), hbc),
    ).toBe(false);
    expect(namesSomeoneElse(img("https://www.harvarduc.org/content/v1/x/40-LOGO.png"), hbc)).toBe(false);
  });
  it("skips interface icons in the header", () => {
    expect(
      logoUrlProblem(
        "https://cdn.prod.website-files.com/6384/63841b93ee7073892181ed7b_close.svg",
        "https://openbiolab.org/",
        "header_img",
      ),
    ).toMatch(/interface/);
    expect(logoUrlProblem("https://club.test/img/menu-icon.png", "https://club.test/", "header_img")).toMatch(
      /interface/,
    );
    expect(logoUrlProblem("https://club.test/img/close-up-logo.png", "https://club.test/", "header_img")).toMatch(
      /interface/,
    );
  });
});

describe("Instagram profile pictures", () => {
  it("reads only the account's own picture, never Instagram's stand-in", async () => {
    const { profilePictureUrl, pictureKey, pictureFileName } = await import("../src/stages/instagram-picture");
    const pic =
      "https://scontent-lga3-1.cdninstagram.com/v/t51.2885-19/106127586_272970620649329_4695668203792863429_n.jpg?stp=dst-jpg_s150x150&oe=6A1B2C3D";
    const html = `<img alt="someoneelse's profile picture" src="https://scontent.cdninstagram.com/v/x/other_n.jpg">
      <img alt="harvardlampoon's profile picture" src="${pic.replace(/&/g, "&amp;")}">`;
    expect(profilePictureUrl(html, "harvardlampoon")).toBe(pic);
    expect(profilePictureUrl(html, "nobody")).toBeNull();
    expect(
      profilePictureUrl(
        `<img alt="x's profile picture" src="https://scontent.cdninstagram.com/v/t51/464760996_1254146839119862_3605321457742435801_n.png?a=1">`,
        "x",
      ),
    ).toBeNull();
    expect(profilePictureUrl(`<img alt="x's profile picture" src="https://evil.test/a_n.jpg">`, "x")).toBeNull();
    expect(pictureKey(pic)).toBe(
      "https://scontent-lga3-1.cdninstagram.com/v/t51.2885-19/106127586_272970620649329_4695668203792863429_n.jpg",
    );
    expect(pictureFileName(pic)).toBe("106127586_272970620649329_4695668203792863429_n");
    expect(pictureFileName("https://club.test/logo.png")).toBeNull();
  });
});

describe("Instagram's stand-in picture", () => {
  it("is recognised by its look, whatever file it comes from", async () => {
    const { looksLikeDefaultAvatar } = await import("../src/stages/instagram-picture");
    const svg = (bg: string, fg: string) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="${bg}"/><circle cx="75" cy="55" r="26" fill="${fg}"/><ellipse cx="75" cy="150" rx="55" ry="50" fill="${fg}"/></svg>`,
        ),
      )
        .jpeg()
        .toBuffer();
    expect(await looksLikeDefaultAvatar(await svg("#efefef", "#8e8e8e"))).toBe(true);
    // The same shapes in a club's colours, or black on white, are a real picture.
    expect(await looksLikeDefaultAvatar(await svg("#efefef", "#a51c30"))).toBe(false);
    expect(await looksLikeDefaultAvatar(await svg("#ffffff", "#111111"))).toBe(false);
  });
});
