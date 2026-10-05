import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * Images on a page that may be the site's own logo, collected before chrome removal (the
 * logo lives in the header). Which one is used, and whether it is usable at all, is decided
 * later by `pickLogo` with the measured images (stages/logos.ts).
 */
export interface LogoCandidate {
  url: string;
  kind: "jsonld" | "header_img" | "img" | "apple_touch_icon" | "icon" | "og_image";
  /** Declared icon size in px (from `sizes`), when known. */
  size: number | null;
  /**
   * The words the page gave the image: its original file name and alt text. Kept because
   * `url` may be a canonical address without them (Wix originals), and rules read names
   * ("coop_harvard_logo1.webp" is a sponsor's mark).
   */
  hint?: string;
}

/** Class/id words that mark a logo or brand slot ("site-logo", "navbar-brand", "header-title-logo"). */
const LOGO_SLOT = /logo|(^|[-_\s])brand(ing)?($|[-_\s])|wordmark|lockup|emblem|site-title|site-icon/i;
/** Containers that are the site header ("header#SITE_HEADER", Weebly's "header-inner-wrap"). */
const HEADER_SLOT = /(^|[-_\s])(header|navbar|masthead|topbar|banner)($|[-_\s])|^SITE_HEADER/i;
/** Ancestors checked for a logo slot: the logo image sits a few levels inside it. */
const SLOT_DEPTH = 4;

/**
 * Original upload instead of a resized, blurred or cropped rendition. Wix's lazy loader puts
 * a ~50 px blurred placeholder (`/v1/fill/w_69,h_25,…,blur_2/…`) in the HTML; the file
 * itself is at `/media/<id>~mv2.<ext>`. PURE.
 */
export function canonicalImageUrl(url: string): string {
  const wix = /^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+?\.(?:png|jpe?g|gif|webp|svg))\/v1\/.*$/i.exec(url);
  if (wix?.[1]) return wix[1];
  return url;
}

/** Words of a name for comparison ("THE HARVARD POPS ORCHESTRA" ≈ "The Harvard Pops Orchestra"). */
const nameKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The site's own name, from og:site_name and the parts of the <title>. */
function siteNames($: CheerioAPI): Set<string> {
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    const k = s ? nameKey(s) : "";
    if (k.length >= 3) names.add(k);
  };
  add($('meta[property="og:site_name"]').attr("content"));
  const title = $("title").first().text();
  add(title);
  for (const part of title.split(/\s+[|–—:·-]\s+/)) add(part);
  return names;
}

const attr = (el: Element, name: string): string => el.attribs?.[name] ?? "";

/** The largest image in a `srcset` ("a.png 1x, b.png 2x" or "a.png 300w, b.png 1500w"). */
function largestInSrcset(srcset: string): string | undefined {
  let best: { url: string; n: number } | undefined;
  for (const part of srcset.split(/,\s+/)) {
    const [url, d] = part.trim().split(/\s+/);
    if (!url) continue;
    const n = Number.parseFloat(d ?? "1") || 1;
    if (!best || n > best.n) best = { url, n };
  }
  return best?.url;
}

export function collectLogoCandidates($: CheerioAPI, pageUrl: string, jsonLd: readonly unknown[]): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const add = (raw: string | undefined, kind: LogoCandidate["kind"], size: number | null = null, alt = "") => {
    if (!raw || raw.startsWith("data:")) return;
    try {
      const full = new URL(raw.trim(), pageUrl).toString();
      const url = canonicalImageUrl(full);
      if (!/^https?:/i.test(url) || out.some((l) => l.url === url)) return;
      const hint = url === full ? alt.trim() : `${full.split("/").pop() ?? ""} ${alt}`.trim();
      out.push({ url, kind, size, ...(hint ? { hint } : {}) });
    } catch {
      /* unparseable */
    }
  };

  for (const node of jsonLd) {
    const stack: unknown[] = [node];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        stack.push(...n);
        continue;
      }
      const rec = n as Record<string, unknown>;
      const logo = rec.logo;
      if (typeof logo === "string") add(logo, "jsonld");
      else if (logo && typeof logo === "object" && typeof (logo as { url?: unknown }).url === "string")
        add((logo as { url: string }).url, "jsonld");
      if (rec["@graph"]) stack.push(rec["@graph"]);
    }
  }

  const names = siteNames($);
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    /* relative page URL: no home-link check */
  }
  /** A link to the site's home page, the usual wrapper of a header logo. */
  const isHomeLink = (el: Element): boolean => {
    const href = attr(el, "href").trim();
    if (!href) return false;
    if (href === "/" || href === "./" || href === "#") return true;
    try {
      const u = new URL(href, pageUrl);
      return u.origin === origin && (u.pathname === "/" || u.pathname === "") && !u.search;
    } catch {
      return false;
    }
  };

  $("img").each((_, node) => {
    const el = node as Element;
    const src =
      attr(el, "src") ||
      attr(el, "data-src") ||
      attr(el, "data-image") ||
      largestInSrcset(attr(el, "srcset") || attr(el, "data-srcset")) ||
      undefined;
    if (!src) return;
    const alt = attr(el, "alt");
    let inHeader = false;
    let inSlot = LOGO_SLOT.test(`${attr(el, "class")} ${attr(el, "id")} ${attr(el, "elementtiming")}`);
    let homeLink = false;
    let depth = 0;
    for (let p: AnyNode | null = el.parent; p && p.type === "tag"; p = p.parent, depth++) {
      const pe = p;
      const tag = pe.tagName.toLowerCase();
      // Site builders put theme switches on <body> ("tweak-…-header-…"): not a container.
      if (tag === "body" || tag === "html") break;
      const cls = `${attr(pe, "class")} ${attr(pe, "id")}`;
      if (tag === "header" || tag === "nav" || attr(pe, "role") === "banner" || HEADER_SLOT.test(cls)) inHeader = true;
      if (depth < SLOT_DEPTH && LOGO_SLOT.test(cls)) inSlot = true;
      if (depth < SLOT_DEPTH && tag === "a" && isHomeLink(pe)) homeLink = true;
    }
    const saysLogo = /logo/i.test(`${src} ${alt}`);
    const namedAsSite = names.has(nameKey(alt));
    // In the header, any of these marks the site's logo. Elsewhere only the image's own words
    // count: footers and sponsor grids carry other marks in "logo" slots.
    if (inHeader && (inSlot || saysLogo || homeLink || namedAsSite)) add(src, "header_img", null, alt);
    else if (saysLogo || inSlot) add(src, "img", null, alt);
  });
  $('link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]').each((_, el) => {
    const size = Number(($(el).attr("sizes") ?? "").split("x")[0]) || null;
    add($(el).attr("href"), "apple_touch_icon", size);
  });
  $('link[rel~="icon"]').each((_, el) => {
    const size = Number(($(el).attr("sizes") ?? "").split("x")[0]) || null;
    add($(el).attr("href"), "icon", size);
  });
  add($('meta[property="og:image"]').attr("content"), "og_image");
  return out;
}
