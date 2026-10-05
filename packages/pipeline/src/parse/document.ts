import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { cleanLinkLabel, normalizeUrl } from "@hci/core";
import { cleanText } from "./html";
import { collectLogoCandidates, type LogoCandidate } from "./logo-candidates";

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
  /**
   * Text of the paragraph or list item around a short body link ("Learn more about our comp
   * here"), so a link whose own text says nothing can be read in its sentence.
   */
  context?: string;
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

export type { LogoCandidate };

const REMOVE = "script, style, noscript, template, svg, iframe, canvas, form, button, input, select, textarea";
const LINK_CONTEXT = "p, li, dd, td, th, blockquote, h1, h2, h3, h4, h5, h6";
const CHROME = "nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]";
// `skip-link` but not a skip link's *target*: WordPress block themes give the page's own
// <main> the id `wp--skip-link--target`, and dropping it loses the whole article.
const JUNK_RE =
  /cookie|consent|gdpr|newsletter-popup|modal|popup|skip-link(?![-_]*target)|screen-reader|sr-only|visually-hidden/i;

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

  const logoCandidates = collectLogoCandidates($, pageUrl, jsonLd);

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
    const text = cleanLinkLabel(cleanText(label.text())).slice(0, 200);
    const chrome = $(el).closest(CHROME).length > 0;
    const block = !chrome && text.split(" ").length <= 3 ? $(el).closest(LINK_CONTEXT) : null;
    const context = block?.length ? cleanText(block.first().text()).slice(0, 600) : "";
    links.push({ url: abs, text, chrome, ...(context && context !== text ? { context } : {}) });
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
