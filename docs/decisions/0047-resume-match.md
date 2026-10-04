# 0047 — Clubs for your resume (`/match`), matched in the browser

Date: 2026-10-04 · Status: accepted (owner request)

## Context
The owner asked for a page where a student adds a resume and gets clubs that fit them, "using AI".
The site is a static export (ADR 0022): there is no server to hold an API key, paid APIs are off by
default (ADR 0038), and a resume carries personal data (names, contact details, schools) that hclubs
otherwise never handles.

## Decision
Owner's choice (2026-10-04): match **in the browser** for now; no LLM.

- `/match` reads a PDF (pdf.js, `pdfjs-dist`, loaded only when a PDF is chosen; first 6 pages) or a
  text file, or pasted text. Nothing is uploaded, stored (not even localStorage) or tracked beyond
  one GoatCounter event `resume-match` that carries no content.
- `readResumeInterests` (`@hci/db/local/resume.ts`, PURE) finds interests: search concepts
  plus a short resume-only list of skills and job titles ("python" → Software, "equity research" →
  Finance), and rare club-name words written as names ("Bhangra"). Contact lines, a first line that
  is only a name, generic resume phrases ("social media", "customer
  service") and words inside longer outside names ("Phillips Academy", "Goldman Sachs", "Boys & Girls Club": never
  read as the student's identity) are skipped.
- `matchResume` scores clubs with the directory's own `matchClub`, per interest, capped (12; 30 when
  the club is named for it) so a typed-query bonus never lets one word win, weighted by mentions,
  generic topics (research, mentoring) at half, plus a bonus per extra matched interest. At most 5
  picks led by the same interest come before clubs led by others that are at least half as strong.
  Ended clubs and graduate-school groups are left out (`boardEligible`).
- The page shows the interests it read as chips the student can turn off, and each pick says which
  interests chose it.

## Consequences
- Free, private, works on the static site. It reads words, not meaning: it won't infer "likes
  teaching" from "led a nonprofit", and clubs with thin pages are hard to match.
- Dependency: `pdfjs-dist` (PDF text extraction; lazy-loaded on `/match` only).
- Later (needs a server, M5): an optional "Refine with AI" step that sends the text to Claude with an
  explicit notice, rate limits and a budget.
