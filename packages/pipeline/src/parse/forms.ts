import type { DocBlock, PageDocument } from "./document";

/**
 * Application forms (ADR 0027). Clubs link their application forms (Google Forms,
 * Typeform, Airtable, Jotform); a form's public title and description often state the
 * deadline, eligibility and comp steps. §21 allows reading a form's publicly visible
 * description, never its questions or responses, so a fetched form page is reduced to
 * title + description before any extractor sees it.
 */

const FORM_HOST =
  /(^|\.)(docs\.google\.com|forms\.gle|forms\.office\.com|typeform\.com|airtable\.com|jotform\.com|form\.jotform\.com|tally\.so)$/i;

export function isFormUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (!FORM_HOST.test(host)) return false;
    return host !== "docs.google.com" || u.pathname.startsWith("/forms/");
  } catch {
    return false;
  }
}

/** Generic platform blurbs that aren't the club's description. */
const BOILERPLATE =
  /^(create your own|made with|powered by|sign in|this form|google forms?|typeform|airtable|jotform|never submit passwords)/i;

/** Only a form's title and public description, as a document the extractors can read. PURE. */
export function formDescriptionDoc(doc: PageDocument): PageDocument {
  const title = (doc.ogTitle ?? doc.title ?? "")
    .replace(/\s*[-|–]\s*(Google Forms?|Typeform|Airtable)\s*$/i, "")
    .trim();
  const description = (doc.ogDescription ?? doc.metaDescription ?? "").trim();
  const paragraphs = description
    .split(/\n{1,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && !BOILERPLATE.test(p));
  const blocks: DocBlock[] = [];
  if (title) blocks.push({ index: 0, kind: "heading", level: 1, text: title, section: null });
  for (const p of paragraphs) blocks.push({ index: blocks.length, kind: "paragraph", text: p, section: title || null });
  const text = [title ? `# ${title}` : "", ...paragraphs].filter(Boolean).join("\n");
  return {
    ...doc,
    title: title || null,
    h1: title || null,
    blocks,
    links: [],
    text,
    jsonLd: [],
    looksJsRendered: false,
    logoCandidates: [],
  };
}
