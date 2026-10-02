# HClubs autonomous backlog

Rules: CLAUDE.md §26. Priorities: **P0** broken or wrong for users · **P1** major user value · **P2** solid improvement · **P3** polish.
Item format: `- [P#] Title — user problem · evidence · owner agent · (notes)`. Keep it ranked within each section. Move finished items to COMPLETED THIS RUN with a one-line result and commit.

## ACTIVE

File ownership: search-discovery → packages/db/src/local search/concepts/intents/similar + search tests · recruiting-engineer → app/recruiting, recruiting-board/-now, profile/joining*.tsx, CycleStatusPill/status logic, board logic · frontend-engineer (Sonnet) → rest of apps/web/src · product-data-engineer → packages/pipeline, core derivations, DB via audited CLI. Lead commits and builds. Cap: 3–4 long-lived teammates (owner, 2026-10-02); short Sonnet specialists for reviews; no bulk crawling; minimal paid search; stop rather than switch to metered billing.


## READY

- [P2] Directory: when result.negated is non-empty ("not recruiting"), say "We can't search for clubs that aren't recruiting; showing all" · frontend · search QA
- [P3] Label: Extension School / post-bacc groups shown as "Graduate school" (no Extension value in the school list) · human/product call · data follow-up
- [P2] "No experience needed" filter (noexp=1) data layer + Postgres parity + explicit phrases → filter · search-discovery (Sonnet) running; UI chip after frontend commit
- [P3] Browse paths NOT supported by data (don't add as homepage paths): Outdoors (~12 text hits, no category), Low commitment (hours known for 14/705), Join anytime as a headline (23 open + 5 attendance + 8 rolling; fine on /recruiting). Hours need submissions, not crawling · data pass
- [P2] Postgres SearchProvider parity for constraint phrases (call interpretQuery) — static site unaffected · search-discovery · low priority
- [P2] /saved polish: summary strip ("2 due this week · 3 join anytime"), "Next step" link per row (Apply / Website / Join anytime), remove with undo, sticky mobile Compare bar · frontend · UX
- [P2] "Social / make friends" intent: "social" + open membership gives only 5; Social & Community category mixes in final clubs · search-discovery + data · UX
- [P3] recruiting-board.tsx:139 min-h-9 below sm → 44px · recruiting-engineer
- [P3] Compare truncates to 4 before dropping missing slugs · frontend · QA
- [P3] index.json has no version in its URL → stale cached index mixed with new HTML after republish; fetch /data/index.json?v=<generatedAt> · frontend/perf · UX
- [P3] searchLocal unmemoized in directory.tsx; Filters mounted twice · frontend · perf
- [P3] Build-budget test (index gz <300 KB, initial JS <230 KB gz, /about must not fetch index.json) · perf (short task)
- [P3] Unknown params silently ignored; contradictory combos offer only one relaxation · frontend · QA

## IN REVIEW

- [P1] Frontend batch (frontend-engineer, done): mobile nav fits 320, recruiting chip first on rows (closed for 120 days, "usually Spring"), quick chips + collapsed More filters, name-only panel hides search sources, homepage footer line, 44px targets, link labels, typeahead with Save, constraint/soft-word notes, Closest matches · adversarial-qa (Sonnet) reviewing + testing


- [P0/P1] Recruiting (done, review fixes applied, 800 tests pass): board rewrite with one section per club (buildBoardSections), home off-season rows, next-step wording, profile "Missed this deadline?" reuses board rules, compare "Next chance" row + "Only X recruits in spring" · shares [slug]/page.tsx + compare-view.tsx with the frontend batch → commit together after frontend QA

## BLOCKED / HUMAN REVIEW

- **Republish hclubs.app soon:** live directory search is broken on the published site (typing doesn't filter; only Enter works) — fixed in c662fb8, needs `scripts/publish-pages.sh` (owner decides when to publish).

- Paid APIs (Anthropic extraction, categorize, summarize; Brave search) — need owner approval and a budget for each run. The Brave prepaid credit ran out earlier (CLAUDE.md §22, M3 fourth pass).
- Publishing to hclubs.app and pushing to git — owner decides when.
- Sanctioned export of the official student-organization list from the College / DSO — owner outreach (CLAUDE.md §22, M3 item 1).

## COMPLETED THIS RUN

- [P1] Search QA fixes: negations never apply a filter (returned as `negated`), bare "easy" is a soft word ("easy finance" 0 → 27), "without dues"/"nocomp", filler words, typeahead acronym prefix > initials, "mun" suggests Model UN · search-discovery + adversarial-qa
- [P2] Scope v6 + career-center club pages read again: HGWISE, HESA, HES Premedical → graduate school (off default results); Social rejected for HCDU, GUSH, HES Sustainability (from "socials") · product-data-engineer

- [P1] Search pass + data pass committed a9dac9d: constraint phrases → filters, soft words re-rank, activity-floods removed, suggest(); joining.noExperience (43 clubs), uncategorized 28→20, HFAC wrong links rejected, Band historical tryout rejected, CSSA junk descriptions rejected; HUA open / HAGSA attendance confirmed correct · search-discovery + product-data-engineer

- [P1] Profile JSON no longer publishes deadline sourceText (a quote) / parseConfidence; privacy-scan flags them · lead (found by recruiting-engineer)

- [P1] Persona UX audit (9 missions, desktop + mobile) done; findings distributed above. Working well: First-years+no comp preset (22 clubs), "VC", "hcgg"→hccg, "hbsa", compare summary

- [P2] Header Compare link now opens the tray's picks (bare /compare redirects); Clear still empties both · lead · verified in dev

- [P1] Compare tray no longer loads the 136 KB index on every page; hidden on /saved; tray contrast + 44px · lead
- [P1] Adversarial QA sweep done: audit 0 critical/high, privacy-scan clean, 718 internal links OK, 25 odd queries OK; findings filed (recruiting double-listing → recruiting-engineer)

- [P1] Profile links in club lists no longer prefetch on viewport (~500 KB less on first directory load) · lead · verify on next static build

- [P2] Saved clubs: save toggle on rows + profiles, Saved nav count, /saved urgency-sorted with joining/status/hours/Apply, compare from saved, share-link import; review caught merged slugs being cleared → now follow redirects · frontend-engineer + code-reviewer · c662fb8

- [P2] Squarespace logos always downsized to 300w (stored ?format=1500w ignored before) + regression test · lead

- [P2] Perf/a11y audit done: budgets OK (index 136 KB gz, JS ~186 KB/route, CLS 0.02, no 320px overflow, SEO tags present); findings filed in READY
- [P0] Static build: typing in the directory search didn't update results (search-box compared "/clubs/" with "/clubs") — normalized trailing slash · found by performance-accessibility · verify on next static build
