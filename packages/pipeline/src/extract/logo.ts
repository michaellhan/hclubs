import type { LogoCandidate } from "../parse/logo-candidates";
import { baseDomain, hostOf } from "../audit/text";

/**
 * Choosing a club's logo among the images its home page offers. PURE.
 *
 * Two kinds of rule, shared with the logo audit (audit/checks/logos.ts):
 *  - URL rules: what the address says (another organization's mark, a template file, a
 *    third-party widget, a white variant named as such);
 *  - image rules: what the measured image is (too small, too wide, white on transparent,
 *    blank). Measurements come from `image_probe` (stages/logos.ts).
 */
export const LOGO_PICKER = { name: "logo-picker", version: "1.2.0" } as const;

/** Images that are never the club's own logo (university marks, platforms, social icons). */
export const NOT_CLUB_LOGO =
  /((^|[^a-z])harvard[-_ ]?(university|shield|veritas|college)[^/]*\.(png|svg|jpe?g|gif|webp)|signature[-_ ]horizontal|shield|veritas|squarespace-(logo|favicon)|wix(static)?\.com\/.*favicon|parastorage\.com\/client\/|\bs\d\.wp\.com\/i\/|\/wp-includes\/|gravatar|facebook|instagram|twitter|linkedin|youtube|tiktok|google(?!usercontent)|apple-pay|paypal|venmo|placeholder|spacer|pixel|sponsor|partner|upload\.wikimedia\.org|\.svg\.png|wordpress\.com\/i\/|wpcom)/i;

/** Filenames of another organization's mark (sponsors, Harvard-wide marks, platforms). */
export const OTHER_MARK =
  /(coop|sponsor|partner|harvard[_-]?(logo|shield|seal|wordmark)|swlogo|surfing-waves|powered-?by|badge|instagram|facebook|twitter|linkedin|tiktok|youtube|social[-_]?icon|apple-pay|paypal|venmo|google-play|app-store)/i;

/** Image CDNs of site builders: a logo there comes from whichever site embedded it. */
export const BUILDER_CDN =
  /(^|\.)(squarespace\.com|squarespace-cdn\.com|wixstatic\.com|wsimg\.com|website-files\.com|wp\.com|wpmucdn\.com|sanity\.io|tumblr\.com|weebly\.com|editmysite\.com|carrd\.co|zyrosite\.com|amazonaws\.com|cloudfront\.net|googleusercontent\.com|ctfassets\.net|imgix\.net|cloudinary\.com|githubusercontent\.com|substackcdn\.com|webflow\.com|framerusercontent\.com|cdninstagram\.com)$/;

/** Files left over from a site template ("logo-test.png", "sample-logo.svg", "default.png"). */
const TEMPLATE_FILE = /(^|[-_ .])(test|sample|example|demo|template|default|dummy|your[-_ ]?logo)([-_ .]|$)/i;

/** White variants for dark backgrounds, by file name ("whitelogotext.png", "HGCC-logo-white_edited"). */
export const WHITE_ONLY = /white|(^|[^a-z])(wht|inverse|reversed)([^a-z]|$)/i;
const WHITE_WORD = /(^|[-_ /(+])(white|light|reverse[d]?|inverse|inverted|negative)\b/i;

/**
 * A file named as a variant for dark backgrounds. Only a guess: when the image has been
 * measured, the measurement decides instead ("logo-inverted.png" can be dark). PURE.
 */
export function whiteByName(url: string): boolean {
  const file = fileName(url);
  return (
    WHITE_WORD.test(decoded(url)) ||
    (WHITE_ONLY.test(file.replace(/\.[a-z]+$/i, "")) && /\.(png|svg|webp)$/i.test(file))
  );
}

/** Interface icons that sit in headers next to the logo (a menu's close button, a cart). */
const UI_ICON =
  /(^|[-_ .\d])(close|menu|hamburger|burger|search|arrow|chevron|caret|cart|bag|play|pause|loader|spinner|x-?icon)([-_ .\d]|$)/i;

/** Several marks in one file ("HUCP logos (1).jpg", "sponsor-logos.png"): a collage. */
const COLLAGE = /logos\b/i;

/** Uploaded screenshots: a photo of something, unless the site put it in its logo slot. */
const SCREENSHOT = /screen[-_ ]?shot/i;

/** Kinds the site itself declares as its logo; a file name doesn't overrule that. */
const DECLARED: ReadonlySet<LogoCandidate["kind"]> = new Set(["jsonld", "header_img"]);

/** Photo-like images; a file that says "logo" is still a logo ("Logo – Transparent Background.png"). */
const PHOTO_LIKE = /(^|[-_ /])(banner|hero|background|cover|header-image)\b/i;

const SAYS_LOGO = /logo|lockup|wordmark|emblem/i;

/** Declared pixel width in CDN image URLs (Wix `w_32`, Squarespace `format=100w`, `?w=`). */
function declaredWidth(url: string): number | null {
  const m = /(?:[/,]w_|[?&]w=|format=)(\d{2,4})(?:w\b|[,&/_]|$)/i.exec(url);
  return m ? Number(m[1]) : null;
}

function decoded(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\+/g, " "));
  } catch {
    return url;
  }
}

function fileName(url: string): string {
  try {
    return decoded(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

/**
 * Why an image address can't be the club's logo, or null. `pageUrl` lets a club site hosted
 * on a Harvard server (`ai.hcs.harvard.edu`) use its own images; other harvard.edu images
 * are university marks. `kind`: a site's declared logo slot isn't second-guessed by its file
 * name ("Screen_Shot_2024….png" as the header logo). PURE.
 */
export function logoUrlProblem(url: string, pageUrl?: string, kind?: LogoCandidate["kind"], hint = ""): string | null {
  const host = hostOf(url);
  if (!host) return "not a valid URL";
  const text = `${decoded(url)} ${hint}`;
  if (NOT_CLUB_LOGO.test(url) || NOT_CLUB_LOGO.test(text)) return "another organization's mark or a stock image";
  const file = `${fileName(url)} ${hint}`;
  if (OTHER_MARK.test(file) || OTHER_MARK.test(host)) return "another organization's mark";
  if (TEMPLATE_FILE.test(file.replace(/\.[a-z0-9]+$/i, ""))) return "a site template's file";
  if (UI_ICON.test(fileName(url).replace(/\.[a-z0-9]+$/i, ""))) return "an interface icon";
  const declared = kind !== undefined && DECLARED.has(kind);
  if (!declared && SCREENSHOT.test(text)) return "a screenshot";
  if (!declared && COLLAGE.test(text)) return "several logos in one image";
  if (!declared && !SAYS_LOGO.test(text) && PHOTO_LIKE.test(text)) return "a banner or photo";
  const pageHost = pageUrl ? hostOf(pageUrl) : "";
  // Only a club's own subdomain of a Harvard group host ("ai.hcs.harvard.edu").
  if (/(^|\.)harvard\.edu$/.test(host) && !(host === pageHost && host.split(".").length > 3))
    return "a Harvard-wide image";
  if (pageHost && !BUILDER_CDN.test(host) && baseDomain(host) !== baseDomain(pageHost))
    return `served by ${host}, not by the club's site`;
  const w = declaredWidth(url);
  if (w !== null && w < 64) return "a small rendition";
  return null;
}

/** Pixel statistics of an image, from `measureImage` (logo-measure.ts). */
export interface ImageStats {
  /** Share of pixels that aren't (nearly) transparent. */
  opaque: number;
  /** Share of opaque pixels darker than a light background (luminance < 0.75). */
  dark: number;
  /** Spread of luminance across opaque pixels (0 = one flat color). */
  lumSpread: number;
  /**
   * Share of pixels that stand out from our light tile once the image is laid on it
   * (luminance at least 0.25 away from the tile's): what a reader actually sees.
   */
  ink: number;
}

export interface ImageMeasure {
  width: number;
  height: number;
  format: string;
  stats: ImageStats;
}

/** What `pickLogo` knows about one image: measured, failed to load, or not probed yet. */
export type ProbeLookup = (
  url: string,
) => { ok: true; measure: ImageMeasure } | { ok: false; error: string } | undefined;

/**
 * Why a measured image can't be shown as a logo on our light tile, or null. PURE.
 * Wide wordmarks up to about 3:1 still read at 40 px; beyond that they're a sliver.
 */
export function logoImageProblem(m: ImageMeasure): string | null {
  const vector = m.format === "svg";
  const { width: w, height: h, stats } = m;
  if (!w || !h) return vector ? null : "no size";
  if (stats.opaque < 0.01 || (stats.lumSpread < 0.02 && stats.opaque > 0.97)) return "blank";
  // White or very light marks on a transparent background vanish on a light tile.
  if (stats.opaque < 0.97 && stats.dark < 0.04) return "a light logo for dark backgrounds";
  if (stats.ink < 0.03) return "too faint on a light background";
  if (!vector && Math.max(w, h) < 96) return `too small (${w}×${h})`;
  if (w / h > 3.2) return `too wide (${w}×${h})`;
  if (h / w > 2) return `too tall (${w}×${h})`;
  return null;
}

// Body images named "logo" are often partner/sponsor grids, so they rank last.
const KIND_RANK: Record<LogoCandidate["kind"], number> = {
  jsonld: 0,
  header_img: 1,
  apple_touch_icon: 2,
  og_image: 3,
  icon: 4,
  img: 5,
};

/** Words a logo file is named with that say nothing about whose logo it is. */
const NAME_FILLER =
  /logos?|transparent|background|removebg|preview|final|copy|edited|untitled|design|version|new|old|black|white|colou?r(ed)?|main|primary|secondary|small|large|medium|icon|image|img|photo|png|jpe?g|svg|webp|web|site|header|footer|horizontal|vertical|stacked|full|mark|wordmark|lockup|cropped|crop|square|circle|round|high|res|official|updated?|alone|text|wording|and|the|of|for|with/gi;

/**
 * Words that tie an image to the club: its names' words, initials (with and without
 * "Harvard", "Undergraduate", "College"…) and its site's domain label. PURE.
 */
export function clubNameTokens(names: readonly string[], siteUrl?: string): Set<string> {
  const out = new Set<string>();
  const minor = new Set(["the", "of", "and", "for", "at", "in", "a", "an", "on", "to"]);
  // Initials drop these step by step: "Harvard Undergraduate Biotechnology Club" is HUBC, HBC, HB and B.
  const school = new Set(["undergraduate", "undergraduates", "college", "university", "radcliffe"]);
  const kind = new Set(["club", "society", "association", "group", "organization"]);
  for (const name of names) {
    const words = name
      .toLowerCase()
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    for (const w of words) if (w.length >= 3) out.add(w);
    const core = words.filter((w) => !minor.has(w));
    if (core.length < 2) continue;
    const initials = (ws: string[]) => ws.map((w) => w[0]).join("");
    const noSchool = core.filter((w) => !school.has(w));
    out.add(initials(core));
    out.add(initials(noSchool));
    out.add(initials(noSchool.filter((w) => !kind.has(w))));
    out.add(initials(noSchool.filter((w) => !kind.has(w) && w !== "harvard")));
  }
  if (siteUrl) {
    const label = hostOf(siteUrl).split(".").slice(-2, -1)[0];
    if (label && label.length >= 3) out.add(label);
  }
  for (const t of out) if (t.length < 2) out.delete(t);
  return out;
}

/**
 * Whether a body image's name ("biogenlogo.png", alt "The YX Foundation logo") names someone
 * other than the club. Names with no telling word left ("logo.png", "40-LOGO.png") pass.
 * PURE.
 */
export function namesSomeoneElse(c: LogoCandidate, clubTokens: ReadonlySet<string>): boolean {
  const text = `${fileName(c.url).replace(/\.[a-z0-9]+$/i, "")} ${c.hint ?? ""}`
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, " ") // content hashes
    .replace(NAME_FILLER, " ");
  const words = text.split(/[^a-z]+/).filter((w) => w.length >= 3);
  if (!words.length) return false;
  return !words.some((w) => [...clubTokens].some((t) => (t.length >= 3 ? w.includes(t) || t.includes(w) : w === t)));
}

export interface LogoPick {
  candidate: LogoCandidate;
  measure: ImageMeasure | null;
}

/**
 * Why one candidate can't be the logo, or null. Without `probe`, only the address is judged
 * (and bare favicons and white-named files are skipped); with it, the image must have been
 * measured and pass `logoImageProblem`. PURE.
 */
export function candidateProblem(
  c: LogoCandidate,
  pageUrl?: string,
  probe?: ProbeLookup,
  clubTokens?: ReadonlySet<string>,
): string | null {
  const url = logoUrlProblem(c.url, pageUrl, c.kind, c.hint);
  if (url) return url;
  // Body images named "logo" are often a partner's or sponsor's: theirs must name the club.
  if (c.kind === "img" && clubTokens && namesSomeoneElse(c, clubTokens)) return "named for someone else";
  const saysLogo = SAYS_LOGO.test(`${decoded(c.url)} ${c.hint ?? ""}`);
  // Share images are usually banner photos.
  if (c.kind === "og_image" && !saysLogo) return "a share image not named as a logo";
  if (probe) {
    const p = probe(c.url);
    if (!p) return "not measured";
    if (!p.ok) return p.error;
    return logoImageProblem(p.measure);
  }
  if (whiteByName(c.url)) return "a white logo for dark backgrounds (by name)";
  if (c.kind === "icon") {
    // Unmeasured: a big or vector icon, or an icon file named as the logo; not a bare favicon.
    const w = declaredWidth(c.url);
    const big = (c.size ?? 0) >= 96 || (w ?? 0) >= 96 || /\.svg(\?|$)/i.test(c.url);
    if (!big && !(saysLogo && !/\.ico(\?|$)/i.test(c.url))) return "a small favicon";
  }
  return null;
}

/**
 * The club's logo among its home page's candidates, or null. PURE.
 * Among usable candidates, the site's declared kinds rank first, but a square-ish mark
 * beats a wordmark (1.8:1 or wider) of any kind, since logos show as small squares.
 */
export function pickLogo(
  candidates: readonly LogoCandidate[],
  pageUrl?: string,
  probe?: ProbeLookup,
  clubTokens?: ReadonlySet<string>,
): LogoPick | null {
  const usable: { c: LogoCandidate; m: ImageMeasure | null; score: number; order: number }[] = [];
  candidates.forEach((c, order) => {
    if (candidateProblem(c, pageUrl, probe, clubTokens)) return;
    const p = probe?.(c.url);
    const m = p?.ok ? p.measure : null;
    let score = KIND_RANK[c.kind];
    if (m) {
      const vector = m.format === "svg";
      // At 40 px a wordmark's lettering is a smudge; the site's own square mark reads (HUCG).
      if (m.width / m.height >= 1.8) score += 5;
      if (!vector && Math.max(m.width, m.height) < 128) score += 1.5;
    }
    usable.push({ c, m, score, order });
  });
  usable.sort((a, b) => a.score - b.score || (b.c.size ?? 0) - (a.c.size ?? 0) || a.order - b.order);
  const best = usable[0];
  return best ? { candidate: best.c, measure: best.m } : null;
}
