import * as cheerio from "cheerio";

/** Collapse whitespace (including NBSP) and trim. */
export function cleanText(input: string | undefined | null): string {
  // Zero-width spaces and BOMs separate words the way a space does ("2024\u200bthe").
  return (input ?? "").replace(/[\s\u00a0\u200b\ufeff]+/g, " ").trim();
}

/** Visible text of an HTML document, for storage alongside the raw snapshot. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template, iframe").remove();
  const blocks: string[] = [];
  $("body")
    .find("h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, blockquote, figcaption, a")
    .each((_, el) => {
      const text = cleanText($(el).clone().children("p, li, ul, ol, table").remove().end().text());
      if (text) blocks.push(text);
    });
  const out = blocks.length > 0 ? blocks.join("\n") : cleanText($("body").text());
  return [...new Set(out.split("\n"))].join("\n");
}
