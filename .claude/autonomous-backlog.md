# HClubs autonomous backlog

Rules: CLAUDE.md §26. Priorities: **P0** broken or wrong for users · **P1** major user value · **P2** solid improvement · **P3** polish.
Item format: `- [P#] Title — user problem · evidence · owner agent · (notes)`. Keep it ranked within each section. Move finished items to COMPLETED THIS RUN with a one-line result and commit.

## ACTIVE

_(nothing in progress)_

## READY

- [P1] Persona audit of all 8 student journeys, desktop + mobile — no audit since the ADR 0041 pass; turn findings into ranked items here · owner: product-ux
- [P1] Search benchmark on realistic queries (quant, VC, venture capital, startup, finance, consulting, poker, hiking, Chinese, AI, coding, robotics, easy clubs, clubs for freshmen, no comp finance, still recruiting) — judge the top 10 for each; fix mechanisms, not query strings · owner: search-discovery
- [P1] Recruiting flow review at today's date (2026-10-02, fall recruiting): board sections, closing soon, missed-recruiting alternatives · owner: recruiting-engineer
- [P1] Adversarial sweep of the static build: filter combos, bad queries, routes, odd records, console errors, 320px layout · owner: adversarial-qa
- [P2] Saved clubs / shortlist — doesn't exist; only the 4-club compare tray in localStorage (`apps/web/src/lib/use-compare.ts`). Students can't keep a list of clubs to look at later · owner: frontend-engineer (spec from product-ux first)
- [P2] Performance and accessibility pass on the current build: index/JS size vs budgets, keyboard flow, contrast, SEO tags · owner: performance-accessibility

## IN REVIEW

_(nothing awaiting review)_

## BLOCKED / HUMAN REVIEW

- Paid APIs (Anthropic extraction, categorize, summarize; Brave search) — need owner approval and a budget for each run. The Brave prepaid credit ran out earlier (CLAUDE.md §22, M3 fourth pass).
- Publishing to hclubs.app and pushing to git — owner decides when.
- Sanctioned export of the official student-organization list from the College / DSO — owner outreach (CLAUDE.md §22, M3 item 1).

## COMPLETED THIS RUN

_(none yet)_
