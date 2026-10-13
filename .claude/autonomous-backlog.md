# HClubs autonomous backlog

Rules: CLAUDE.md §26. Priorities: **P0** broken or wrong for users · **P1** major user value · **P2** solid improvement · **P3** polish.
Item format: `- [P#] Title — user problem · evidence · owner agent · (notes)`. Keep it ranked within each section. Move finished items to COMPLETED THIS RUN with a one-line result and commit.

## ACTIVE

- In progress 2026-10-13 (main-checkout session, background agents; avoids search/UI files owned by vibrant-hellman): product-ux persona round 8 (done: findings in READY) · adversarial-qa sweep (worktree) · performance-accessibility audit (done: findings in READY) · product-data-engineer P3s: shared-host crawl scoping + resolver-v23 connective openers (done on worktree-agent-ab74a1833ff91f902, in code review) · product-data-engineer round 8 data items (Creative Writing category, Advocate comp timing/About, restating aliases, STEM hours, creative one-liners; main checkout, audited CLI).
- (done) In progress 2026-10-12 (three agents in parallel): search-discovery (isolated worktree) → identity similar/ranking, audience demotion, and/or, no audition, comp, concept gaps, fund/Perform intents, sparse "make friends"; frontend-engineer (isolated worktree) → row next-chance line, comp gloss, source labels/unknowns, pills, mobile tray/header, /about copy, P3 UI; product-data-engineer (this worktree) → finance/consulting seasons + HUCG stages, dance/theater categories, identity-club descriptions, HPR comp, P2 data items. READY items below stay listed until each agent's work is reviewed and merged.

File ownership: search-discovery → packages/db/src/local search/concepts/intents/similar + search tests · recruiting-engineer → app/recruiting, recruiting-board/-now, profile/joining*.tsx, CycleStatusPill/status logic, board logic · frontend-engineer (Sonnet) → rest of apps/web/src · product-data-engineer → packages/pipeline, core derivations, DB via audited CLI. Lead commits and builds. Cap: 3–4 long-lived teammates (owner, 2026-10-02); short Sonnet specialists for reviews; no bulk crawling; minimal paid search; stop rather than switch to metered billing.


## READY
- [P2] Hours floors return 0 results: "10+ hours", "5+ hours", "at least 10 hours", "more than 10 hours" ("more" → "morse"); floors must be ignored, never fatal · QA 2026-10-13, `it.fails` in packages/db/test/search-qa-floors.test.ts (drop .fails when fixed) · search-discovery (other session owns search)
- [P3] Search nits: lone "what's"/"whats up" matches WhatsApp and Stand-Up Comics (apostrophe stop word); "movie" ranks Video Game Development Club first · QA 2026-10-13 · search-discovery (other session)
- [P3] A /compare link with >4 clubs and one dead says "only the first four are shown" but fills column 4 from the 5th slug; a shared link replaces the visitor's tray (launch-audit decision; revisit?) · QA 2026-10-13 · frontend-engineer
- [P2] (IN PROGRESS, vibrant-hellman data agent) Creative clubs: Creative Writing Collective filed only under Arts & Performance (add Publications & Media); its similar clubs lead with CHANCE and miss the Advocate; Film Club/Electronic Music Collective/FIG./Fashion/Knitting have no one-liner (source gap) · persona round 8 · product-data-engineer (in progress: running agent, 2026-10-13)
- [P2] (IN PROGRESS, vibrant-hellman data agent) The Advocate: comp with no When; stored /comp page is nav-only (JS-rendered?) → try `enrich --browser --club=harvard-advocate` · persona round 8 · product-data-engineer (in progress: running agent, 2026-10-13)
- [P2] (IN PROGRESS, vibrant-hellman time agent: top-120 clubs) Hours/week stated for 5/109 STEM and 1/55 publications/hobbies clubs; `snapshots search "hours (a|per) week" --missing=club.hours_per_week` over STEM, else officer form · persona round 8 · product-data-engineer (in progress: running agent, 2026-10-13)
- [P3] Saved list may hold a duplicate slug (badge showed 100; "harvard-crimson" twice) — check dedupe on write · persona round 8 (shared pane, unconfirmed) · adversarial-qa
- [P3] WiCS aliases restate the name ("Women in Computer Science", "… (WiCS)") · product-data-engineer
- [P3] 375px directory filter row wraps "More filters" to a second line (~50px) · frontend-engineer
- [P3] The Advocate's About is a ~2,000-char Wikipedia history, nothing current · product-data-engineer
- [P2] (IN PROGRESS, vibrant-hellman frontend agent) Profile category link is 17px tall on phones (page.tsx, owned by vibrant-hellman until its merge) · perf-a11y audit 2026-10-13 · frontend-engineer
- [P2] (IN PROGRESS, vibrant-hellman frontend agent) Small targets: /clubs empty-state links 64x40/88x40; /saved Compare checkbox 16x16 (check label padding); row name link 24px (row is stretched-link, so only focus/pointer checks) · perf-a11y audit · frontend-engineer (waits: directory-empty.tsx and saved-view.tsx are in vibrant-hellman's diff)
- [P2] (IN PROGRESS, vibrant-hellman data agent) ~166 club logos hotlinked from squarespace/wix/wp/etc. (unmeasured weight, outside our control); mirror like /logos/ig or measure bytes · club-logo.tsx:106-108 · product-data-engineer (next, after the current P3 data agent returns; fetches club images, so polite crawler + ADR) (in progress: running agent, 2026-10-13)
- [P3] First-load JS: /clubs 228 KB, /match 239 KB gz (budget 250, warned by js-budget.mjs); trim if either nears it · performance-accessibility
- [P3] /compare with an unknown slug may render blank with no h1 (seen in a throttled hidden pane; retest) · compare-view.tsx:493 · adversarial-qa → frontend-engineer
- [P3] Compare table column headers lack scope="col" · compare-view.tsx ~600 · frontend-engineer
- [P3] /match: nameless 1x1 interactive element (hidden file input?) — verify not keyboard-reachable unnamed · resume-match.tsx · performance-accessibility
- [P3] Keyboard flows (/, arrows, Esc, drawer focus trap) not verified in the audit (pane throttled); retest in a foreground tab · performance-accessibility
- [P3] HCES and Photonics sites (*.seas.harvard.edu) answer our crawler with 403 · BLOCKED (source; not bypassed)
- [P3] Harvard Model Congress: robots.txt disallows crawlers, so How to join stays unknown · BLOCKED (source)
- [P3] Remaining name-only cultural clubs (49/126 without one-liner) need club pages or submissions (no stored text describes them) · BLOCKED on sources
- [P3] Probable duplicate: Harvard College Video Game Development Club vs Harvard Undergraduate Game Developers (handle pattern only, not merged) · needs a stronger identifier · product-data-engineer
- [P3] Public-service programs: 67/91 have no join mode; if a pbha.org page states the shared volunteer application, record per program with the quote · product-data-engineer

## IN REVIEW

## BLOCKED / HUMAN REVIEW
- OWNER DECISION (2026-10-13): the persona round 8 search items below wait on claude/vibrant-hellman-6a1d0f, which holds 6 commits not on main (search round 14 + round 7 UI) and has been idle ~20 min. Options: lead merges that branch into main (tests first) and fans the search items out to 2–3 agents, or wait for that session to merge. Asked in chat.
  - [P1] (IN PROGRESS: owned by the claude/vibrant-hellman-6a1d0f session, which is merging its round 14 with main's 2ca8e8b; agreed 2026-10-13 ~17:00, the main-checkout session stands down) Persona round 7 — athlete, remaining: "no weekly meetings" negation; flexible/low commitment service/service one day; soccer → Futsal; intramural noise; Meet people in Topic menu; club-sports form label everywhere; /saved banner at 375px (data part done) · search-discovery + frontend-engineer — fixed on that branch (a116a52, 9ec3265), not yet on main
  - [P1] (IN PROGRESS: owned by the claude/vibrant-hellman-6a1d0f session, which is merging its round 14 with main's 2ca8e8b; agreed 2026-10-13 ~17:00, the main-checkout session stands down) Persona round 7 — international first-year, remaining: bollywood/classical dance, graduate chapters in Still time to join, counts 531 vs 669, "level" jargon, Women in Business under Cultural; UI: "No comp" gloss, ISA caveat wording, compare names at 375px, "next fall" → term name, costNote wording (data part done) · search-discovery + frontend-engineer — fixed on that branch (a116a52, 9ec3265), not yet on main
  - [P1] (QUEUED: vibrant-hellman search agent after the round-14 reconcile) Spelling correction sends real words to wrong index words with 0 results — "creatve writing"→"create", "fine arts"→"find", "music producer"→"produce", "poetry slam"→"sama", "spoken word"→"work", "manga"→"manage" · persona round 8 · fix: never keep a correction that leaves 0 full results; containment tie-break · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P1] "writing"/"writing club": Creative Writing Collective (name match) #6 behind category-only HPR, Real Estate Review, Law Review · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P1] Music production unreachable: dj/edm/beats/making beats/music production/songwriting never surface the Electronic Music Collective · persona round 8 · new concept + clubNames · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P1] Visual arts concept too broad: "painting"/"drawing" led by Creative Writing Collective ("creative"), the Crimson, HackHarvard; "drawing" → Physics #1; /match too · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P1] "stem" reads as stem cells (Stem Cell Society #1 for "low commitment stem"); should mean STEM fields unless "cell" typed · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] Passing mentions pad results under a constraint when few strong matches ("creative writing still join" → Business Board via activity "creative") — STRONG_TOPIC_MIN skip in search.ts ~2744; prefer relaxed hint · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] Film: activity-list "film screenings" puts Psychedelics Club/Beekeepers in "film" top 5 and /match · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] No creative/research topic in the Topic menu; ?do=make-art only 2 clubs (misses Arts & Crafts, ASAP, Black Arts Collective, Advocate) — widen before adding · persona round 8 · search-discovery + frontend-engineer (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] "serious"/"intense"/"rigorous" are required text → 0 results ("serious cs club"); read as selectivity lift or filler · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] /match: section labels ("Hobbies") and vague "research" become interests; duplicate chips (Software & CS + CS; Film & video + Films + Video); biology clubs miss top 20 while HMMT organizer appears; DJ/poetry not specific interests · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] Soft words lift passing mentions over a name match ("transfer student art": Arts & Crafts #8; "low commitment cs": conference "programming") · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
  - [P2] Concept gaps: plays→theater, lit mag, chemistry↔chemical, bioinformatics, screenwriting/animation/zine/anime (most have no club) · persona round 8 · search-discovery (search files owned by vibrant-hellman until its round-14 merge)
- ~55 cultural/arts clubs with no public source for a description (list in the round-3 content report: Armenian SA, Asian American Brotherhood, QSA, SAA, Turkish SA, Iranian Association, Pakistani SA, Tap Company, Jazz Bands …) — need club input via the officer form or submissions.
- No description from any free source (need club input; a paid summarize has no club text to anchor): Harvard South Asian Association, South Asian Business/Music/Women's, Queer Students Association, Latina Empowerment & Development; Breakers only has a 2016 Crimson paragraph. Finance clubs with one round only (HFAC, HIA, HAI, HUVCG, HUREIG, HUCP, CREL, HUMG) — no stated pattern.
- [P3] Blank cultural clubs (South Asian Association, Pakistani SA, BASHA, Folklorico Company, Omo Naija): no website, Instagram only, and no stored page describes them (only personal bios, never used) — need club or student input. Bhangra and Ballet Folklórico already have one-liners from editor facts (pending publish); Eleganza's Dance tag is grounded on its own site (kept) · data · BLOCKED on sources
- Unknown joining at top clubs is a source gap, not an extraction gap (rechecked 2026-10-04): Democrats, Republican Club, HCS, Veritones, Chinese Students Association, Hasty Pudding Theatricals state no membership process on any public page we can read. Product Lab resolved (application). Levers: the officer form and student submissions (the Ask the club chip was removed by the owner, 2026-10-12).
- "N students recently asked this club" (shared count across visitors) needs a server or a public read of GoatCounter counts; the static site only remembers each visitor's own ask. Owner call (M5).



- Eligibility gaps on selective clubs (e.g. Kroks' male-only membership is only in its description; Crimson Business Board says nothing about first-years): no free source beyond club pages already read; needs student submissions or club input.


- Publishing to hclubs.app and pushing to git — owner decides when.

## COMPLETED THIS RUN
- QA sweep merged 0867d50: dead-slug compare links no longer overwrite the tray, unindexed picks dropped, slug length capped at 120, header wordmark hidden below 340px (no sideways scroll at 320px with a Saved count). ~130 hostile queries, joinTiming at 9 boundary times, URL params and storage corruption all clean.
- Shared-host crawl scoping (`isSharedHostFolder`: Google Sites, HCS ~name, PBHA programs, Wix, other keyed hosts) + resolver-v23 (descriptions opening with a connective rank below same-tier ones; HUCG) merged ceb300c after code review. Lead to run on the DB: `pnpm hci resolve --diff`, `projection diff`, `audit`.
- JS budget (2026-10-13): `apps/web/scripts/js-budget.mjs` runs after every web build, printing each key page's gzipped first-load JS and warning above 250 KB (`--strict` fails); today 184–239 KB.
- Perf/a11y follow-ups (2026-10-13): form placeholders stone-400 → stone-500 (~4.7:1, AA) in feedback/suggest/officer forms; profile "Suggest an update"/"I run this club" 44px tall on phones. Not changed: similar-club rows are already whole-row stretched links (~56px); SaveToggle's per-row empty status regions are deliberate (a live region must exist before its text changes to be announced).
- 2026-10-13 Stale items closed after checking: Ballroom's follow-us About text is caught by `socialFollowProblem` (952957a, verified on the exact text); the two Pickleball rows are already merged (harvard-pickleball-club → pickleball-club-sport).
- 2026-10-13 QA sweep (taken over from the idle 04:48 run): long-query overflow, junk do= badge, page=999 (capped at 10×30 rows), /saved share links offer only listed clubs, corrupt compare tray (already safe; test added), ArrowDown waits for fresh results, no 404 flash on mis-cased club links, 44px tap targets, function-word-only and doubled-word queries. Merged ae4e677. ESLint now ignores .claude/** (agent worktrees were being linted).
- Bio/notice/archive rule gaps closed (1.16.49, g26): first-person career bios, "… have begun! Want to join?" notices, archive-cited past narrative; 0 live findings, replay retracted nothing.
- History/archive/alumni pages (1.16.48, g25): per-claim rules (`historyClaimProblem`, `pastFactProblem`, `archivalSubjectProblem`); 10 history-page descriptions retracted (Glee founding story, Kuumba/AAA history, Independent personal essay, Evening with Champions founder), 2 alumni-page activities rejected, Glee summary kept (dismissed).
- `facts` checks clock times ("9:00", "6:45") as written instead of as two numbers.
- Round 7 sports/service data: joining-v7 stated tracks (Ultimate, no "Sources differ"), Karate eligibility false positive, 21 schedules (meeting frequency 42 → 63), tennis merged, sex-suffix aliases hidden, jobs pages out of Sources, Special Olympics one-liner.
- Harvard-host club sites crawlable: SEAS club subdomains, sites.harvard.edu folders (path-scoped), w1af; Classical Club, HUFPI, STAHR, Wireless Club gained data (6 bad values rejected).
- Round 7 data: Ghungroo described as the SAA's annual show (kept separate: SOCO registers it), HSAA one-liner + Ghungroo activity, `joining.costNote` (joining-v6; Karate "uniform at own cost"; the Kroks' tour is "at no cost to their members"), login-only pages never listed as sources.
- PBHA/IOP: a verified site at a directory host's home page now gets a joining-pages-only crawl (`directoryHostedSite`); PBHA Fall 2026 deadline Sep 18 recorded from pbha.org/apply.
- Search round 13: joinable-this-term first under Still time to join, comp/punch/tryout definitions (shared with /about), punch → invite-only, Meet people topic, outdoors/prelaw/legal/technical interview/rocket/math competition, organizers after participants, Build software ranks building clubs, brand words out of similar clubs, chips stay disabled, row category follows the topic, /match newspaper editor.
- LLM replay recorded 808 fully read pages; 30 reworded repeats retracted (--only-restated).
- LLM retraction needs a recorded pass: a page counts as re-read by site-llm only when every request covering it ran or replayed (`LlmCoverage`, `requirePass`). Measured: most earlier flags were g21 rewording of the same fact (use `--only-restated`: 14 candidates).
- Persona round 6 president's check (1.16.47, g24, resolver-v22, press-v7): show seasons and production-position comps aren't recruiting seasons (HPT), sibling press attribution (HPT 17 → 5 items), HP Institute umbrella cleaned, Kroks booking pitch → own About, at most two emails per profile, HUWIB 400+ and fall/spring, Crimson stitched mission and menu activities, Google Form /edit → /viewform, Travel tag hidden, HCS activity fold, PBHA one-liner and About, roster pages out of Sources, dues periods ("$20 per 6 months").
- Persona round 6 UI: comp gloss without a duration, rolling = can join now in compare, /for-clubs shows the current page + "Something here is wrong", 28px footer/similar tap targets, source titles truncate, tray names (no slugs), compare name wrap + logo initials fallback, /saved How to join link, Selection-process note removed, "fall, spring and summer", calendar-month relative dates, "Meets" label, "Fall 2026 applications closed".
- Persona round 6 data (1.16.46, g23): HMMT team registration + scam notice, HUMIC program applications, block-element spacing in page text (HUQT stages), HUAC acronym, Substack posts never newsletters, HUSAI garbled text, Creative Writing summary overstated, "Adult Services" → "Shelters, Elders & Community". LLM replay/retract waits for the retract fix (43 pages' cached LLM output no longer matches their spaced text).
- Bio and notice rules (1.16.45, g22): first-person and named bios, donation asks, registration notices never About/mission/activities/summaries; live audit 0 findings.
- Search round 12: class-year words soft ("for sophomores"), spelling note only for unknown words, HDAG in "consulting spring", passing mentions under constraints, case interviews → consulting, Startups & VC topic, Orchestra & strings concept, "no audition" last tier, "sing" stems, Volunteer topic ranks service programs first, PBHA programs as similar, /match orchestra interest; search engine lazy-loaded (/clubs JS 242.7 → 216.8 KB gz).
- Persona round 5 data: HUCG case-interview stage rejected (`stageKindFromLabel`), announcement/follow-us/audition-prep rules (1.16.44, g21), Ventures renamed Harvard Undergraduate Ventures + Entrepreneurship, Photography → Hobbies & Games, wrong categories (VISION, HMUN, Debate) and 2 off-topic press items rejected, 21 clubs' meeting times + Jazz Orchestra seasons from their own pages.
- Persona round 5 recruiting: "Last comp: Spring 2026" from a past round (never a pattern), Product Lab closed-without-date wording, bare rounds hidden (VCG), Band open with no-cut audition (joining-v5), Pitches pattern hidden beside an announced round, August dates are fall (`recruitingTermForDate`), compare summary leads with "Can join now".
- Persona round 5 UI/a11y: twin websites collapse (`areTwinHosts`), More links tags only without own label, /saved one-club wording, Esc keeps search focus, /feedback roving radios, More filters Esc, disclosure h2 headings + key-fact "Joining", name-only line only when nothing shown, "See PBHA programs" link.
- [P2] Shared-host footer accounts merged different orgs (Hasty Pudding) → matcher-v4: folders on a shared host and handles read only off that host/footer are review signals (`shared_host`, `shared_host_social`), never strong ids; live autoMerged stays 0.
- Round 4 (2026-10-13): search round 11 (selectivity words as a selection step with a note, politics stem, op-eds, transfers, hospital volunteering, EMS, video games, tennis/debate ranking), frontend round 4, Wikipedia full sentences (73 fragments retracted), About rules (8 letters/notices/recaps retracted), per-round no cuts (HCDU), resume match round 4, health/politics/sports facts (CrimsonEMS fall round, IOP Common App, 36 club sports get the Club Sports interest form), legal pages never links, www twin after 404, office pages keep harvard_official tier (facts v2), positions are roles (joining-v4), press v6 (247 passing mentions dropped), curated v20.
- [P1] Model UN registration shown as how students join: HMUN "Application · First-years eligible" → harvardmun.org/application-process (high-school delegations; "college students are not eligible"); HNMUN "rolling" from delegation applications (ranks #2 in Still time) — undergrads staff both via the HIRC Common App · reject + evidence rule for conference-registration pages (delegates, high school, MUNager) · product-data-engineer + recruiting-engineer → DONE (round 3): conference-registration evidence rule (extractor 1.16.38, g17, audit recruiting.conference_registration); 5 claims rejected; no HMUN/HNMUN page says staff join via HIRC, so unknown.
- [P1] Stale or guessed dates: Fed Challenge "due Feb 6, 2027" (page gives no year; recruits spring before fall competition → Feb 6, 2026) shown as upcoming; HIRC "How to apply" is "IRC Common App: Fall 2025" (apps.harvardirc.org/f25) · contradicted-year rule miss; past-cycle form titles naming 2025 · recruiting-engineer → DONE: applications-for-a-named-year rule (paragraph-wide) dropped the guessed Feb 6 2027; check-forms fetched apps.harvardirc.org/f25, audit application.past_cycle rejected it; URL term codes ("/f25") now read too.
- [P1] HCDU: fall = application + two tryout speeches; "Spring Comp … is open and completion based" → spring round should read Comp (no cuts); stages order wrong (Tryout → Info → Application); spring searches ("what can I join in spring", "spring comp") miss it because the season constraint ignores announcedLaterRound · product-data-engineer + search-discovery + recruiting-engineer → DONE (data part): Spring 2027 round = Comp with the club's "open and completion based" words (editor-read cycle facts); stages in one paragraph take process order. The fall form now shows closed, so the fall stages left with it. Search season constraint is search-discovery's.
- [P2] HCDU "In the news" shows Debate Council articles (different org) · press rescore with HCDU/HDC distinction · product-data-engineer → DONE: press-v5 (headline names another indexed club) dropped the Debate Council article and 4 similar.

- Owner decisions 2026-10-12: no outreach to the College/DSO (dropped); paid APIs (Brave, Anthropic) approved, keep spend minimal; remove the Ask the club chip site-wide (done: chip, email/DM panel, localStorage memory and GoatCounter event removed; frontend-engineer).

- Owner decision 2026-10-12: press headlines and source titles may name students as published (ADR 0026 policy stands); no redaction, and privacy-scan stays as is.

- [P2] Past rounds' forms (recruiting-engineer): a hosted form whose label or fetched title names a round already over is never featured as How to apply (the comp/join page or "Check how to apply at …" instead; More links shows "Fall 2026 round"); the past-cycle audit already covered the Independent's Spring 2026 form. Lead: Lampoon's When cell had vanished (build-time check ran at the date-only opening's UTC midnight) — whenKnown now also checks at build time; moved to lib/when-known with a test.

- [P2/P3] Activity churn and AISST (product-data-engineer): `retract-unreproduced --only-restated` retracted 170 of 337 LLM activity rewordings (kept 86 only-statements and 71 fuller wordings; no club lost an activity); AISST renamed AI Safety Team (AIST) per its site, old names kept as aliases; eligibility labels on fellowship pages aren't open membership (extractor 1.16.33, grounding g15); Crimson Dance Team re-fetched (stored copy was an error shell).

- [P1/P2] Search round 9 (search-discovery): identity concepts (Black & African diaspora with African/Caribbean/Haitian, East Asian, Asian American, Muslim) with identity-sense only for "black"; broad identity groups before pre-professional ones; audience clubs demoted on topics that don't name them (voice parts aren't audiences: Kroks #1 for "a cappella"); identity-aware similar clubs (BSA → Black Men's Forum, African SA, ABHW…); venue nouns out of theater; "or"/"and" between topics = union; "no audition" demotes auditioning groups; lone "comp" ranks comp clubs first; "a capela", "start up", "cross country", running; no bare "fund"; Perform without paid ensembles or event committees; sparse clubs below described ones. Name sweep 1,507/1,507 unchanged.
- [P3] Sources labels (lead): pages on the club's own host read as its website (BSA "About BSA" once); unverified social accounts read "Social account". Kroks archives@ already labelled Email (no change).

- [P1/P2] Data pass (product-data-engineer): "analyst class each semester"-type intakes read as recruiting seasons (extractor 1.16.31); Business/Technology Boards and HDAG fall+spring from their pages; HUCG stages = written application + two interview rounds; name-category v7 + curated v12 (Breakers, Tap, Deepam, Ghungroo → Dance; G&S, IGP, ASAP → Theater; music ensembles); South Asian Men's Collective site found; HPR rolling + meeting time (its comp is the tech team's); WiCS no-cut comp, email-list forms are mailing lists; resolver-v14 one-liners (HRMDC, Computing Contest Club); Kroks testimonial out; 19 IOP meta-description claims retracted; another club's page labelled as a publication; Google usp= params dropped; Auditions/Tryouts/Casting links are apply links (20 clubs). Lead: AISST outsider "summer" season rejected.

- [P1/P2/P3] Frontend pass (frontend-engineer, 506b9e2): rows and /saved show one shared next-chance line (HUCBE "Closed Sep 5 · next round likely in spring"; matches compare/profile); comp/audition/tryout gloss in key facts + focusable tips + /about#joining definitions; no source labels or "don't know yet" text; joining pills capped at two without contradictions; compare tray hidden under More filters and on /saved, /feedback, /for-clubs; one-line mobile result header with icon Copy link; chip a11y text fixed; empty finance + No comp offers the relaxed list; /about copy fixed. Not reproduced: first Topic tap after load (only hardened).

- [P0/P1] Search round 8 (search-discovery, 0be4380): question/helper words never corrected or required ("still"≠"skill", "what is the crimson comp" → Crimson, "what's a comp" → 36 comp clubs); question-only queries browse; "join now"/"still open"/"join this semester" → Still time to join; "recruiting"/"open now" fall back to it when no undergraduate round is open; season words → season filter. Benchmark (118) and name sweep (1,507) unchanged.

- [P0] Program applications and announced rounds (recruiting-engineer): trek/grant/scholarship/funding applications (by sentence or heading above it) are never how members join (extractor 1.16.26, grounding g14, audit recruiting.program_application) — Startups at Harvard and the UC lose application/rolling; Startups' interest form reads "Interest form". A stated round in a later academic year overrides the season pattern: Pitches shows "Next auditions: Fall 2027" on profile, rows, saved and compare, and leaves Still time to join (ADR 0051 amendment).

- [P0] Privacy (product-data-engineer): text naming people (class years, "Directed by …", choreographer lists) never becomes a description, mission, activity or summary (shared namesPeopleProblem in extractor 1.16.25, LLM grounding g13, summarize, facts, audit incl. activities); show blurbs aren't missions; <br>/zero-width spaces no longer run words together; confirm-only re-reads match text whose spacing changed. Swept all 692 clubs: 3 real cases (Modern Dance About + mission, TLA member bios) removed (ADR 0033 amendment).

- [P3] Press rule v4 (product-data-engineer): distinctive one-word names (Porcellian, Hillel, Krokodiloes, Spee, Pleiades, Exister, Opportunes, Datamatch …) count when written as a proper noun and no other club uses the word; publishers' own posts never count as press about themselves. Rescore: 34 mentions restored, 8 own-publication ones rejected; lead rejected one headline naming students joining a final club (§21). Only displayed change: CIVICS likely_active → active (ADR 0043 amendment).

- [P3] Browse-path note re-checked 2026-10-12: still holds (hours known for ~17/692 clubs, 30 confirmed open); no Outdoors / Low commitment / Join anytime home paths. Kept as guidance, not a task.

- [P3] Graduate groups (product-data-engineer, 166c334): HIVE → graduate_school/HGSE from its Innovation Labs listing (scope-statements v9 reads listing descriptions; mixed audiences never College-only); HCSSA stays unknown on purpose: its own pages describe a Harvard-wide association, the GSAS pages a subsidiary chapter. Stored browser renders replace JS shells; `discover --stored` (ADR 0038 amendment).

- [P3] Crimson comp site (product-data-engineer): comp.thecrimson.com now counts as the Crimson's own site. The facts stage types subdomains of a verified website as `club_website` (`isOwnSubdomain` moved to core, shared with the extractor; ADR 0044 amendment). The comp page states no hours, so hours stay unknown. No displayed value changed.

- [P2] Natural-query ranking (search-discovery): "no comp tech clubs" → HCS first (qigong group 10th); "tech" finds computing clubs via their own text; "social clubs to make friends" → Social & Community and cultural clubs, HAGSA out of top 10; umbrella name words, concept-counted-once, smaller Meet-people lift; only "social" changed in the default benchmark · tests · search-discovery

- [P3] /recruiting: picking a broad category offers its subcategories ("Narrow to: Consulting · Finance & Investing · Law") · lead (check on next clean build)

- [P3] Compare summary: "Only X usually recruits in spring" only against clubs whose pattern says otherwise; clubs with no stated pattern get "… don't say when they recruit" · test · lead

- [P3] Directory note for process words: "Clubs whose joining process or round matches “comp” come first; the word itself isn't required" (alone: "Showing clubs whose joining process or round matches …") · test · lead

- [P1] Search round 4 (search-discovery, reviewed + fixed): South Asian and Latino concepts with synonym forms ("south asian dance" 0→3, "latino" 2→19, "desi" no longer design clubs); process words (comp/application/audition/tryout/deadline/due) are lifts, never required text ("newspaper comp" → Crimson first, "consulting club application" → HUCG first, "finance comp deadline" 0→27); hours ranges ("3-5 hours a week" 0→9); senseTerms, SHORTHANDS, deadline windows, exact-process bonus, Postgres parity for process-only queries · tests · search-discovery

- [P2] /recruiting "Missed fall recruiting?": plannable rounds first (closed >30 days with a next round, usual-spring clubs), rolling programs in their own "Recruits on a rolling basis" sub-list, year-away rounds last; one section per club including the closed list (HUCBE once, its closed row names the next round); unknown ?category= slugs resolve to a whole-word prefix match (publications → publications-media) or no filter · tests · recruiting-engineer
- [P2] One-liners for Bhangra and Ballet Folklórico (resolver-v12 leadSentence verbs: performs/combines/celebrates/founded … to); earlier note that editor facts had filled them was wrong — corrected · lead

- [P2] Clubs for your resume (`/match`, owner request, ADR 0047): PDF/text read in the browser, interests as toggleable chips, picks via the search model with reasons; home link · tests · code-reviewed (fixed: one-line lists read as a name, outside org names like "Boys & Girls Club" read as identity, skill terms, stale toggles, racing uploads, PDF word splits) · separate session; static build checked 2026-10-04 (/match prerenders, paste → chips + picks, no console errors)

- [P3] Profile key facts: a club known only to have no comp reads "No comp required" under How to join, with "How members join isn't stated; there may still be an application or audition" · lead

- [P1] Recruiting after this term's round (recruiting-engineer, reviewed + fixed): from Oct 1 / Mar 1 (Boston), a club known only by its seasonal pattern reads "next likely in spring" / "usually again next fall" on the board (moves to the next-term section), profile When and compare, recomputed on the reader's day (pre-mount text is date-independent: no hydration mismatch); stale started rounds no longer hide a club; rolling and this-term rounds excluded. Past-term rounds on profiles collapse to "Last round: Spring 2026" (`splitCycles`); nested Show more inside profile rows fixed (named group). nextChanceText no longer treats last year's same season as this term · tests · recruiting-engineer

- [P3] Directory rows show the category the visitor filtered or searched on (Dance, not "Cultural & Identity"), and drop a category match reason the row already shows · lead (verify on static build before publish)

- [P3] Relaxed-filter hint names the filter, not a typed word ("Only 2 entrepreneurship clubs are confirmed for “First-years eligible”"), and its counts add up (2 + 3 say no + 12 don't say = 17); facet screen-reader text pluralizes ("1 club") · lead

- [P3] Profile activities: "Publishes …" and "Publishing …" bullets collapse into one (display-only stem for -ing words over six letters) · test · lead

- [P3] Similar clubs: compass words (south, north, eastern…) never count as a shared name word (South Asian Association ↔ South Slavic Society) · test · lead

- [P2] "No comp" dead end: a club known only to have no comp (College directory) gets the quiet next-step button to its own channel, worded "Check how to join at hcs.harvard.edu" · lead

- [P3] Compare gains an Experience row (No experience needed / Unknown, yes-or-unknown only); profile "Details" box drops its own "Something wrong?" (the page's closing line asks once); source hosts wrap at dots, not mid-word. Kept on purpose: "How we decide" (a link inside each fact's source popover) and Travel (a sourced College-directory fact) · lead

- [P2] Raw marketing one-liners: resolver-v11 `oneLineDescription` — a source's long/cut-off/shouted/pitch short description gives way to its first describing sentence, verbatim (Outing Club, HACIA, Candela, HKS AITP changed; 18 other diffs were query-time capitalization artifacts). HackHarvard and Computing Contest Club keep their text (no qualifying sentence) · tests · lead

- [P2] Dance: name-category v6 reads named dance styles (bhangra, bharatanatyam, kathak, garba, raas); Harvard Undergraduate Bhangra now in Dance · test · lead

- [P2] Phone taps: a directory row's pill area opens the club on phones (above the row link only from sm, where tooltips work); remove-filter chip and Copy link are 44px on phones; /categories/ index added earlier · lead

- [P2] /saved shows a club's usual pattern ("Recruits on a rolling basis") instead of "No recruiting dates known" when it has no dated round; In the news label carries "latest Feb 2026" (order stays headline-names-club first, then newest); Ask-the-club line "Not sure how to join? Ask the club."; /categories/ index page · lead
- [P2] Declined: an hours filter group in More filters. Hours are stated for ~35 of 692 clubs, below §26's coverage bar; typed hours phrases still become the hours= chip · lead

- [P0] Privacy (student testing): Callbacks' About named its two founders — audit names_people now also catches "Name and Name, two college freshmen" / "Name, a junior" (org-word and longer-proper-noun guards; 0 false positives on live data) and rejected it; search-results pages (Brave) no longer listed as public sources; a news title that is only a person's name on an article addressed by that name shows "<publication> article" · tests · lead
- [P1] "Missed this deadline?" always shows for a closed round (Consulting Group showed nothing because every similar club was closed): next usual round or "No next round announced yet", plus "See who's recruiting in this category" · lead

- [P2] Unknown-joining recheck: HPR's comp page adds a stated first-years fact (all undergraduates eligible to publish; already shown from another source); the rest state nothing on public pages (moved to BLOCKED as a source gap) · lead

- [P3] One isFormUrl in @hci/core (pipeline form descriptions, profile closed-form label, open-join button text; Microsoft Forms/Airtable/Jotform/Tally now count as sign-up forms everywhere) · lead
- [P3] Empty-state relaxation counts now match the page their link opens: start from the URL filters, apply the removal, re-apply what the kept text implies; "without the search" counts with the URL filters only · tests · lead

- [P2] Owner decisions 2026-10-04: HUWIB shows the club's own "over 400" (already so since resolver-v7, ownSourceFirst); Plant-Based past deadline skipped; /about cut to four short paragraphs (sources table and contribution rules removed; methodology keeps the detail); Extension School is a school (`club.school = extension`, scope-statements v7, Mignone 1.0.1) → "Harvard Extension School group" on 5 profiles. The Mignone refetch also brought newer official names/descriptions for 5 clubs; its blanket "pre-professional" category was rejected by the audit's career_center_stamp fix (5 claims) · lead

- [P1] Review fixes: a floor ("more than 5 hours a week", "at least 10", "10+ hours", "or more") is never read as an at-most filter; repeated-label naming only when every page name is readable and distinct (no "Viewform"/form ids; in the current build only HSA changes); typeahead counts plurals/demonyms ("asia" → Asian) as forms of the typed word · regression tests · lead

- [P3] Zero results where dropping any single filter still finds nothing (open + audition + finance + no dues): "These filters rule each other out" with "Clear all filters: N clubs" (keeps the search). Unknown URL params are still ignored on purpose (old links keep working) · lead

- [P3] More links: labels shared by several links ("Apply for this role" ×7 at HSA) give way to each page's name ("Web associate", "MIT tour guide"); unique labels unchanged · test · lead
- [P3] No change: Crimson Business Board /educational-partnerships was already rejected (not reproduced by extractor 1.16+). The article-URL-as-application audit rule stays unbuilt: no live case left after the hand fix · lead

- [P3] /saved: removing a club shows "Removed X. Undo" for 8 s and puts it back in place (also after removing the last one); the sticky mobile Compare bar already existed · lead

- [P3] Hours queries: "3 hours a week" (and "3 hours" typed alone) read as up to 3 hrs/week; numbers past two digits cap at the filter's 100 ("under 1000 hours" no longer falls to text search); "24 hours of code" still isn't a limit · tests · lead
- [P3] Build-budget test (apps/web/src/build-budget.test.ts): index < 300 KB gz, initial JS < 230 KB gz on home/directory/recruiting/about, run against out/ when built. Verified in the browser that /about fetches index.json only when the compare tray has picks · lead

- [P2] SatireV: satirev.org confirmed (curated list v7 entry with the exact short name; links the club's verified @therealsatirev) and crawled: comp page, recruiting seasons, comp mailing-list form. Rejected the site's joke meta tagline as a description and two other groups' Facebook pages it links. HackHarvard: hackharvard.io 301-redirects to hhuh.io, so the shown link works (no change). Expressions' dead domain was already gone. Audit: 0 high · lead

- [P3] Typeahead: a finished word the index knows ("math") ranks names that only begin with it (Mather) below names with the word or its forms; "mathe" still leads to Mather · regression test · lead
- [P3] Compare looks up to 12 slugs and keeps the first 4 found, so dead slugs no longer cost a column; "more than four" note counts found clubs · lead
- [P3] Closed round whose link is a hosted form: button reads "Last round's form (closed)" (pages keep "See how they recruit") · lead
- [P3] Directory search memoized (no rerun on More filters toggle / tray updates); Filters already mounted once since the minimal redesign · lead
- [P3] No change: Fallen Angels' two Instagram accounts are both verified by the club's own sources; recruiting-board Apply already 44px via hc-btn-primary · lead

- [P2] "Ask the club" on profiles missing how/when to join: prefilled email to the club's address or copied Instagram DM, /for-clubs as an aside; per-visitor "You asked on …" memory; GoatCounter `ask-club/<channel>/<slug>` demand events · lead

- [P2] HCI_PAID_APIS=off is the local .env default (spend with HCI_PAID_APIS=on <cmd>); refresh.sh skips its LLM steps when off instead of failing · lead

- [P3] index.json fetched as /data/index.json?v=<build stamp> (NEXT_PUBLIC_INDEX_VERSION, set per static build), so new pages never pair with an index cached from an earlier publish; verified on a static build · lead

- [P2] 1683579: minimal recruiting board (one column, four filter dropdowns + Clear, no jump counts, short notes, 5-row lists with Show more/fewer; due-in-7-days and closed lists stay full). Published 2026-10-04 with the top-club pass and the live-search fix (both were waiting on a publish) · lead

- [P1] Profile top answers what / how to join / when / time before the buttons (KeyFacts strip, `joinTiming`, compact Details box) · frontend (lead)

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
