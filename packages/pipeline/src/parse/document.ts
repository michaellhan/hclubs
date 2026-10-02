import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { cleanLinkLabel, normalizeUrl } from "@hci/core";
import { cleanText } from "./html";

/**
 * Page → normalized document for extraction (CLAUDE.md §11.3, M2 §6).
 *
 * Keeps headings, paragraphs, list items, table cells and links with a stable block
 * index so extracted claims can point back to the exact block (`locator.block`).
 * Drops scripts, styles, nav/footer chrome, cookie banners and repeated boilerplate.
 */

export interface DocBlock {
  index: number;
  kind: "heading" | "paragraph" | "list_item" | "table_cell" | "quote";
  level?: number; // heading level
  text: string;
  /** Nearest preceding heading text (section context). */
  section: string | null;
}

export interface DocLink {
  url: string; // absolute, normalized
  text: string;
  /** Link appeared inside nav/header/footer chrome. */
  chrome: boolean;
}

export interface PageDocument {
  url: string;
  title: string | null;
  h1: string | null;
  lang: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  jsonLd: unknown[];
  blocks: DocBlock[];
  links: DocLink[];
  /** Markdown-ish rendering of blocks, used for storage and LLM input. */
  text: string;
  /** Heuristic: the page is an empty JS app shell and needs browser rendering. */
  looksJsRendered: boolean;
  /** Images that may be the site's logo, best kinds first (collected before chrome removal). */
  logoCandidates: LogoCandidate[];
}

export interface LogoCandidate {
  url: string;
  kind: "jsonld" | "header_img" | "img" | "apple_touch_icon" | "icon" | "og_image";
  /** Declared icon size in px (from `sizes`), when known. */
  size: number | null;
}

const REMOVE = "script, style, noscript, template, svg, iframe, canvas, form, button, input, select, textarea";
const CHROME = "nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]";
const JUNK_RE = /cookie|consent|gdpr|newsletter-popup|modal|popup|skip-link|screen-reader|sr-only|visually-hidden/i;

function isJunk(el: Element): boolean {
  const cls = `${el.attribs?.class ?? ""} ${el.attribs?.id ?? ""}`;
  return JUNK_RE.test(cls) || el.attribs?.["aria-hidden"] === "true" || el.attribs?.hidden !== undefined;
}

export function htmlToDocument(html: string, pageUrl: string): PageDocument {
  const $ = cheerio.load(html);
  const meta = (sel: string) => cleanText($(sel).attr("content")) || null;

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).text());
      if (Array.isArray(parsed)) jsonLd.push(...(parsed as unknown[]));
      else jsonLd.push(parsed);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  const logoCandidates: LogoCandidate[] = [];
  const addLogo = (raw: string | undefined, kind: LogoCandidate["kind"], size: number | null = null) => {
    if (!raw || raw.startsWith("data:")) return;
    try {
      const url = new URL(raw, pageUrl).toString();
      if (!/^https?:/i.test(url) || logoCandidates.some((l) => l.url === url)) return;
      logoCandidates.push({ url, kind, size });
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
      if (typeof logo === "string") addLogo(logo, "jsonld");
      else if (logo && typeof logo === "object" && typeof (logo as { url?: unknown }).url === "string")
        addLogo((logo as { url: string }).url, "jsonld");
      if (rec["@graph"]) stack.push(rec["@graph"]);
    }
  }
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? $el.attr("data-src") ?? $el.attr("data-image");
    const hay = `${src ?? ""} ${$el.attr("alt") ?? ""} ${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""} ${$el.parent().attr("class") ?? ""}`;
    if (!/logo/i.test(hay)) return;
    const inHeader = $el.closest("header, nav, [role=banner], .header, #header").length > 0;
    addLogo(src, inHeader ? "header_img" : "img");
  });
  $('link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]').each((_, el) => {
    const size = Number(($(el).attr("sizes") ?? "").split("x")[0]) || null;
    addLogo($(el).attr("href"), "apple_touch_icon", size);
  });
  $('link[rel~="icon"]').each((_, el) => {
    const size = Number(($(el).attr("sizes") ?? "").split("x")[0]) || null;
    addLogo($(el).attr("href"), "icon", size);
  });
  addLogo($('meta[property="og:image"]').attr("content"), "og_image");

  const bodyTextBefore = cleanText($("body").text()).length;
  const scriptCount = $("script").length;

  // Links (collected before chrome removal so footer social links are kept).
  const links: DocLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^(javascript:|#|tel:)/i.test(href)) return;
    const abs = normalizeUrl(href, pageUrl);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    const label = $(el).clone();
    label.find("style, script, svg, noscript, template").remove();
    links.push({
      url: abs,
      text: cleanLinkLabel(cleanText(label.text())).slice(0, 200),
      chrome: $(el).closest(CHROME).length > 0,
    });
  });

  $(REMOVE).remove();
  $("*").each((_, el) => {
    if (el.type === "tag" && isJunk(el)) $(el).remove();
  });
  $(CHROME).remove();

  const root = $("main").length ? $("main").first() : $("body");
  const blocks: DocBlock[] = [];
  let section: string | null = null;
  const seenText = new Set<string>();
  const push = (kind: DocBlock["kind"], text: string, level?: number) => {
    if (!text || text.length < 2) return;
    const key = `${kind}:${text}`;
    if (seenText.has(key)) return; // repeated boilerplate
    seenText.add(key);
    blocks.push({ index: blocks.length, kind, text: text.slice(0, 4000), section, ...(level ? { level } : {}) });
  };

  const walk = (node: AnyNode) => {
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = cleanText($(el).text());
      push("heading", text, Number(tag[1]));
      if (text) section = text;
      return;
    }
    if (tag === "p" || tag === "dd" || tag === "dt" || tag === "figcaption")
      return push("paragraph", cleanText($(el).text()));
    if (tag === "li") {
      // Leaf text of the item (nested lists are walked separately).
      const clone = $(el).clone();
      clone.find("ul, ol").remove();
      push("list_item", cleanText(clone.text()));
      $(el)
        .children("ul, ol")
        .each((_, c) => walk(c));
      return;
    }
    if (tag === "td" || tag === "th") return push("table_cell", cleanText($(el).text()));
    if (tag === "blockquote") return push("quote", cleanText($(el).text()));
    const children = el.children ?? [];
    const hasBlockChild =
      $(el).children("p, div, section, article, ul, ol, table, h1, h2, h3, h4, h5, h6, blockquote, dl").length > 0;
    if (!hasBlockChild && ["div", "section", "article", "span", "main"].includes(tag)) {
      const text = cleanText($(el).text());
      if (text.length > 20) return push("paragraph", text);
    }
    for (const c of children) walk(c);
  };
  for (const c of root.get(0)?.children ?? []) walk(c);

  const text = blocks
    .map((b) =>
      b.kind === "heading"
        ? `${"#".repeat(Math.min(b.level ?? 2, 6))} ${b.text}`
        : b.kind === "list_item"
          ? `- ${b.text}`
          : b.text,
    )
    .join("\n");

  const visible = blocks.reduce((n, b) => n + b.text.length, 0);
  const looksJsRendered =
    visible < 200 && (scriptCount >= 3 || /id=["'](root|app|__next|__nuxt)["']/i.test(html) || bodyTextBefore < 200);

  return {
    url: pageUrl,
    title: cleanText($("title").first().text()) || null,
    h1: blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ?? null,
    lang: $("html").attr("lang") ?? null,
    metaDescription: meta('meta[name="description"]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    jsonLd,
    blocks,
    links,
    text,
    looksJsRendered,
    logoCandidates,
  };
}
