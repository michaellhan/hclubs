"use client";

/**
 * A resume file's text, read in the browser. Nothing is uploaded: PDFs go through pdf.js
 * (loaded only when a PDF is chosen), plain text is read as is.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 6;

export class ResumeReadError extends Error {}

export async function resumeText(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new ResumeReadError("That file is over 10 MB. Try a smaller PDF.");
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return pdfText(file);
  if (file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return file.text();
  if (name.endsWith(".docx") || name.endsWith(".doc"))
    throw new ResumeReadError("Word files can't be read here yet. Save it as a PDF, or paste the text below.");
  throw new ResumeReadError("Use a PDF or a text file, or paste the text below.");
}

async function pdfText(file: File): Promise<string> {
  // The legacy build: the modern one calls Uint8Array#toHex, Math.sumPrecise and
  // Map#getOrInsertComputed with no fallback, so it can't open any PDF in Safari or older
  // Chrome (and fails on embedded fonts, as LaTeX resumes have, in more). Legacy polyfills them.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
      {
        type: "module",
      },
    );
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch {
      throw new ResumeReadError("That PDF couldn't be opened. Try another file, or paste the text below.");
    }
    const lines: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      let line = "";
      /** Where the previous piece of text ended on the line (x), to tell a word gap from a style change. */
      let endX: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4] as number;
        const size = Math.abs(item.transform[0] as number) || 10;
        // pdf.js splits text at font changes inside a word ("B" + "hangra"): join pieces that
        // touch, and add a space only where the page leaves a gap.
        if (
          line &&
          endX !== null &&
          !line.endsWith(" ") &&
          !item.str.startsWith(" ") &&
          Math.abs(x - endX) > size * 0.15
        )
          line += " ";
        line += item.str;
        endX = x + item.width;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
          endX = null;
        }
      }
      if (line) lines.push(line);
    }
    const text = lines.join("\n").trim();
    if (!text) throw new ResumeReadError("No text found in that PDF (it may be a scan). Paste the text below instead.");
    return text;
  } finally {
    void task.destroy();
  }
}
