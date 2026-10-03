# HClubs autonomous backlog

Rules: CLAUDE.md §26. Priorities: **P0** broken or wrong for users · **P1** major user value · **P2** solid improvement · **P3** polish.
Item format: `- [P#] Title — user problem · evidence · owner agent · (notes)`. Keep it ranked within each section. Move finished items to COMPLETED THIS RUN with a one-line result and commit.

## ACTIVE

File ownership: search-discovery → packages/db/src/local search/concepts/intents/similar + search tests · recruiting-engineer → app/recruiting, recruiting-board/-now, profile/joining*.tsx, CycleStatusPill/status logic, board logic · frontend-engineer (Sonnet) → rest of apps/web/src · product-data-engineer → packages/pipeline, core derivations, DB via audited CLI. Lead commits and builds. Cap: 3–4 long-lived teammates (owner, 2026-10-02); short Sonnet specialists for reviews; no bulk crawling; minimal paid search; stop rather than switch to metered billing.


## READY
- P2 Remaining Unknown-joining clubs: most don't state it on their pages; next lever is the club-officer form (one question: how do members join?). Previously: second top-club batch (ADR 0044, done 2026-10-02): clubs still Unknown on joining — HPR, Democrats, Republican Club, HCS, Veritones (robots-blocked), Hasty Pudding (site down), CSA, Fuerza, SAA, Product Lab (JS-only: try `enrich --browser`). Owner: product-data-engineer.
- P2 HackHarvard site moved (hackharvard.io → hhuh.io); Expressions domain dead; SatireV's one-word name can't pass `curatedPageMatch`. Owner: product-data-engineer.

- [P3] "under 1000 hours" / "3 hours" (no "a week") closest-matches odd · search · QA
- [P3] Typeahead "math" suggests Mather House Committee (literal prefix) while search excludes it · search · QA
- [P3] Second Instagram account listed under More links (Fallen Angels) · data/frontend · QA
- [P3] Crimson Business Board /educational-partnerships classified as an application page · data · QA
- [P3] Closed-round "See how they recruit" button points at the closed Google Form — label it "Closed application form" or link the club's page · recruiting · QA
- [P3] Press rule may be too strict for distinctive one-word names (Porcellian, Hillel passing mentions dropped) — loosen pressMentionProblem for distinctive names if wanted · data · ADR 0043
- [P3] Audit rule: article URL used as an application page (handled by hand for the Independent); fold HSA's seven "Apply for this role" job pages · data
- [P3] Label: Extension School / post-bacc groups shown as "Graduate school" (no Extension value in the school list) · human/product call · data follow-up
- [P3] Browse paths NOT supported by data (don't add as homepage paths): Outdoors (~12 text hits, no category), Low commitment (hours known for 14/705), Join anytime as a headline (23 open + 5 attendance + 8 rolling; fine on /recruiting). Hours need submissions, not crawling · data pass
- [P3] /saved: remove with undo, sticky mobile Compare bar · frontend · UX
- [P3] recruiting-board.tsx:139 min-h-9 below sm → 44px · recruiting-engineer
- [P3] Compare truncates to 4 before dropping missing slugs · frontend · QA
- [P3] index.json has no version in its URL → stale cached index mixed with new HTML after republish; fetch /data/index.json?v=<generatedAt> · frontend/perf · UX
- [P3] searchLocal unmemoized in directory.tsx; Filters mounted twice · frontend · perf
- [P3] Build-budget test (index gz <300 KB, initial JS <230 KB gz, /about must not fetch index.json) · perf (short task)
- [P3] Unknown params silently ignored; contradictory combos offer only one relaxation · frontend · QA

## IN REVIEW







## BLOCKED / HUMAN REVIEW
- P1 Publish the top-club pass (ADR 0044) to hclubs.app — owner approval needed (scripts/publish-pages.sh).
- P2 HUWIB member count: site shows 700+ (career office, tier 1) while the club's own site says "over 400"; resolver prefers tier — owner call on whether a club's own current count should win.

- **Paid API spend this run: ~$0.044** — one live LLM call by a data agent whose shell lacked HCI_PAID_APIS=off (Fallen Angels replay). Consider defaulting HCI_PAID_APIS=off in .env so offline work can't spend by accident (config change → owner).
- harvard-undergraduate-plant-based 2025-fall: positions apply-by 9/18 vs comp 9/19 — resolver shows 9/18 with 9/19 as an alternative; a person should confirm which is the general-member deadline (past term, low impact).

- /about says hclubs indexes "the College's student organization directory" (it's the owner's hand-saved copy, ADR 0030). Accurate, but may read as official access; consider "a copy of a student organization listing" — wording/legal framing is the owner's call.

- Eligibility gaps on selective clubs (e.g. Kroks' male-only membership is only in its description; Crimson Business Board says nothing about first-years): no free source beyond club pages already read; needs student submissions or club input.

- **Republish hclubs.app soon:** live directory search is broken on the published site (typing doesn't filter; only Enter works) — fixed in c662fb8 and verified on a fresh static build (2026-10-02), needs `scripts/publish-pages.sh` (owner decides when to publish).

- Paid APIs (Anthropic extraction, categorize, summarize; Brave search) — need owner approval and a budget for each run. The Brave prepaid credit ran out earlier (CLAUDE.md §22, M3 fourth pass).
- Publishing to hclubs.app and pushing to git — owner decides when.
- Sanctioned export of the official student-organization list from the College / DSO — owner outreach (CLAUDE.md §22, M3 item 1).

## COMPLETED THIS RUN

- [P2] 189dbfa: time ranges start at their first time (Fallen Angels 12:30–2:30 no longer "started 2:30"), deadlines don't borrow a later date's time, hedged "rolling basis" rejected (HUCEG) · product-data-engineer (Sonnet)

- [P3] Amber urgency uses calendar days ≤3, same as the "in N days" label · lead

- [P1] Simulated-clock QA (Sep 1 / Sep 8 / Nov 2): wording, EDT times, Apply only when open, /saved order + summary, profile/compare correct; fixed board ordering by string → by instant · adversarial-qa (Sonnet)

- [P3] Category facets collapse on phones with CSS only (no flash) · lead

- [P1] Category pages ordered (open now first, described A–Z, numbers last), 25 rows + Show all, Recruiting now / Join anytime chips, facets in "Filter this list" on phones, "Not stated yet" → help fill in; /contribute search above the fold + jump chips; 404 search + did-you-mean verified on static build; category page HTML 575→461 KB · frontend-engineer (Sonnet)

- [P3] Methodology page in plain language ("How a fact is kept", fixed rules instead of "deterministic resolver"); badge labels, field table, versions collapsed · lead

- [P1] ebeccbe: corrections one tap from the top ("Something wrong? Tell us" in At a glance → bordered, always-visible correction chips), 44px chips, Show fewer topics toggle, no redundant "Use the filter instead", stale /saved picks pruned · frontend-engineer (Sonnet)

- [P2] Audit 4 (categories, contribute, correction flow, about, 404): all categories load; correction opens a prefilled Google Form; glossary clear; findings assigned · product-ux (Sonnet)

- [P2] 814cec7 accessibility: constant names + polite announcements on save/compare toggles, typeahead/compare-picker announcements, named remove buttons, focus not hidden under bottom bars; axe 0 violations light+dark on 6 pages; AA contrast scan clean · performance-accessibility (Sonnet)

- [P3] hours=N in the URL wins over an hours phrase in q (chip, note, results agree) · lead

- [P2] QA of d86561c: fixed anchors under sticky header (scroll-padding), compare marks ended clubs; lead: compare summary names ended clubs once; everything else verified (kroks, hours params, relaxed hint links, sticky /saved bar, Back keeps ticks, board Save 44px, no-JS details) · adversarial-qa (Sonnet) + lead

- [P2] Perf recheck after today's batches (static build): JS 193–218 KB gz/route incl. nomodule polyfill (baseline 190–225), index 136 KB gz, build 190 MB · lead

- [P1] d86561c: kroks→Krokodiloes, finance no comp → relaxed hint, hours phrases → hours=N, social → Meet people rule; mobile compare stacked with decision rows first; sticky Compare bar + urgency sort + status on every card on /saved; Save on board rows; Meet people home chip; board order with Missed at y≈1889 (was 3252); rolling CTA; compare next chance wording · search + frontend + recruiting (Sonnet)

- [P1] Live-browser missions (mobile): no console errors; save from profile 1 tap; Krokodiloes typeahead→profile→save works; friction filed to frontend/recruiting · product-ux (Sonnet)

- [P3] Bare YouTube channel ids no longer used as link labels · lead
- [P1] Round-3 missions (search only; no browser tab available): VC, hcgg, mun, a capella, premed, krokodiloes, beginner dance, easy finance all good; remaining issues → search-discovery · product-ux (Sonnet)

- [P2] Attendance-based clubs' status line says "join by coming to meetings" (matched How to join) · lead

- [P1] QA of profile/home batch: fixed mobile "Show all topics" no-op, 320px overflow from long graduate pills, future term labelled "earlier", one-way Read more; status lines/CTAs/links verified on 15 profiles, no fabricated dates · adversarial-qa (Sonnet)

- [P1] 6ca8775 (ADR 0043): link labels cleaned at the source (no CSS/icon text), outsider grant/declaration/Zoom forms rejected, 21 wrong links rejected by hand, press --rescore rejected 306/944 passing mentions, activities near-dup folded (Kroks 24→11), nav text out of descriptions; 9 clubs active→likely_active as press noise no longer counts · product-data-engineer (Sonnet)

- [P2] 3d581be: "Meet people" intent (100 clubs; social/cultural or stated community purpose; invite-only, final clubs, house committees out; open/no-cut first, sorted by relevance by default) + Postgres constraint-phrase parity · search-discovery (Sonnet) + lead · browser check pending (QA was using the tab)

- [P0/P1] 81753fc: profile recruiting truth (started/closed lines, demoted CTA on closed rounds, open clubs name where to join), More links/email cleanup, ≤3 contribute chips, clamped About, home 12 tiles on mobile, mobile rows without link icons · recruiting-engineer + frontend-engineer (Sonnet); verified HUCG/Lampoon/directory at 375 · note: includes data agent's in-progress near-duplicate dedupe (suite green)

- [P0] Verified on fresh static build (:4173): live search filters while typing ("dance" → 27), no profile prefetches on /clubs, /about loads no index when the compare tray is empty; home off-season box and mobile header render correctly · lead

- [P2] be8b775: No experience needed filter wired (43 clubs, sidebar under More filters, row pill), negated-query note, /saved summary line + next-step buttons, 44px footer · frontend-engineer (Sonnet)

- [P1] Committed c83b57d: recruiting board one section per club + next steps + home off-season rows + profile/compare next chance; directory quick chips, live row status chip, typeahead, mobile header, notes, Closest matches; QA fixed invalid listbox, Esc reopen, dropped type= param, contradictory empty state
- [P2] noExperience filter in packages/db (noexp=1, facets, Postgres parity, explicit phrases → filter) · search-discovery (Sonnet)

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
