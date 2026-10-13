# 0043 Link labels, press strictness, near-duplicate activities, nav text (2026-10-02, $0 spend)

Prompted by a UX audit of profile pages.

## Decisions

1. **Link labels are visible words only.** Anchor text is read from a clone without `style`, `script`, `svg`, `noscript` and `template`, then passed through `cleanLinkLabel` (core): icon-font class prefixes ("icon-comp Comp") and the site-builder "Folder:" prefix are stripped, and CSS-like text becomes empty. A label stays on the first claim seen for a URL, so the projection also cleans labels (`club_link.label`), which fixes old claims without rewriting them. Extractor `site-deterministic` 1.16.6.
2. **Outsider-link rule extended** (`OUTSIDER_LINK`): grant forms, declarations, board chats and Zoom links are not how members join.
3. **Navigation text** (`navTextProblem`, evidence-rules): button labels in capitals ("LEARN MORE") or a call to action closing the text are not a description or mission. Used by the extractor (mission, long description) and the audit (`description.nav_text`, rejects).
4. **Audit:** `link.css_label` (high, rejects the link), `link.markup_label` (report only), `description.nav_text`.
5. **Press mentions (press v3).** `pressMentionProblem` judges a stored mention. The headline naming the club (full name, alias, name minus generic words, trailing generic noun dropped) always passes. Otherwise: nothing before 2010; not one name in a list of organizations; a name of one or two words needs "Harvard <name>" near the start of the sentence, while names of three or more words stand. `press --rescore [--dry-run]` re-judges stored mentions with no search and no fetch, rejecting failures with the reason (reversible, audited); new runs apply the same rule before recording (`CRIMSON_VERSION` 3). Class-year redaction also covers the opening-quote form (‘22).
6. **Near-duplicate activities.** `dedupeNearDuplicates` (core, `resolver-v5`) folds values whose content words are contained in another's (synonyms, "200+" vs "more than 200", vacation/break); the fuller value is kept. Values with fewer than two content words only match identical ones. Applies to `club.activity` only.

## Consequences

- 306 of 944 stored press mentions rejected; 9 clubs moved from active to likely_active because passing mentions no longer count as activity signals.
- Rejecting application links remains manual and per-link (`reject-link`), read against the stored page.

## Follow-up: time ranges and "rolling" (2026-10-02)

- `parseDateExpression` takes the START of a time range and shares the end's am/pm ("12:30–2:30 PM" → 12:30 PM, "7–9pm" → 7 PM, "11–1pm" → 11 AM); "Sept 5–7pm" stays a day range. LLM grounding `g12` applies the same rule.
- Deterministic extractor 1.16.9: a deadline fragment stops at the next date, so a later meeting time isn't read as the deadline's time; shared `rollingProblem` rejects "some … may … on a rolling basis" and "ahead of the … deadline" as evidence of rolling recruitment.
- Replayed offline; Fallen Angels' opening (read from the end of its audition window) and HUCEG's "rolling" were retracted.

## Amendment: distinctive one-word names and a publication's own articles (press v4, 2026-10-12, $0 spend)

Press v3 dropped passing mentions that could only mean one club: "the Porcellian Club", "Harvard Hillel", "the Harvard Krokodiloes" fail the "Harvard <name> at the start of the sentence" test although nothing else carries those names.

- **Distinctive core.** A mention also stands when the matched name's core (the name minus generic words) is one word in `DISTINCTIVE_NAME_WORDS` and the quote writes that word capitalized. The list is editor-reviewed and short on purpose: coined or foreign words that are not ordinary English words, common given names or places, nor another organization's name (citystep, datamatch, exister, hillel, jewskies, krokodiloes, lowkeys, mishelanu, noteables, opportunes, pleiades, porcellian, satirev, spee, yarid). Ordinary words stay under the v3 rule even when capitalized (Advocate, Lampoon, Salient, Signet, Delphic, Fly, Fox, Owl, Callbacks), as do publishers (Crimson, Independent) and words another organization also uses (Kesem, Nucleate, Scientista, Ghungroo). A word that appears in more than one active club's name or alias (`sharedNameWords`, computed from the DB) never counts. Pre-2010 and list-of-organizations rejections still apply first.
- **Own publication.** A publication's own articles are never press about itself (`publisher` equals the club's name or an alias): the Independent's sex survey and essay-coaching posts, the HPR's essay-competition posts. The Crimson club already never matched (no searchable name contains "crimson").
- **Rescore restores.** `press --rescore` also re-judges mentions an earlier rescore rejected (status reason `press-v<N> rescore: …`) and restores those that now pass (audited `restore_claim`); mentions rejected any other way stay rejected. `CRIMSON_VERSION` 4; reasons read `press-v4 rescore: …`.
- **Result:** 34 mentions restored at 14 clubs, 8 rejected (own publication, 2 clubs). Six of the restored mentions pass the unchanged v3 rule under the clubs' current names (Act on a Dream, CIVICS, HULC, Partners in Health Engage, Small Claims Advisory Service, SWE). One displayed change: CIVICS likely_active → active (a December 2025 Crimson mention).
- Mentions that v3 kept out at ingestion time (never stored) come back only with a new `press` run.

## Amendment: retiring LLM paraphrases of activities (2026-10-12, $0 spend)

`retract-unreproduced --extractor=site-llm --version=club-extract-v4+g14 --field=club.activity` listed 337 claims. Every one sat on a page the g14 replay re-read (each page carried g14 evidence for the same club; no site-llm pass rows exist, so a cache miss leaves no evidence and can never make a page look re-read). 226 came from the older prompt (v3), the rest from earlier v4 groundings. All 335 that have a quote still find it verbatim in the latest copy of their page (2 had none): they are wording churn between model runs, not facts the pages stopped saying. Retracting all of them would have dropped real activities stated only once (a medical-innovation group's projects, the Ethics Society's competition results, the Krokodiloes' radio and TV appearances).

- **`restates(value, other)`** (core, pure) is true when `value` adds nothing to `other`: its content words are all in `other`, or the two share most of them (Jaccard ≥ 0.4, both at least two words) and `value` is not the fuller wording. A fuller wording never restates a shorter one.
- **`retract-unreproduced --only-restated`** retires a candidate only when it restates an active value of the same club and field that stays. Read the dry run first (§23 rule 10).
- **Result:** 170 retracted (105 contained in a kept value, 59 rewordings, 6 fuller wordings that another kept value also restates), 167 kept (86 only statements of an activity, 71 fuller wordings of a kept value, 8 folded under another kept candidate, 2 one-word values such as "Soccer"). Displayed activities changed at 51 clubs, almost all by dropping a second wording of the same activity (the Crimson's "Publishes …" beside "Publishing …", Chinatown Teen's 11 → 4). No club lost an activity.

Also in this pass: an "Eligibility. Open to all …" line is who may apply, not open membership (evidence rule, deterministic 1.16.33, grounding `g15`); found on AI Safety Team's fellowship application page.

## Amendment (2026-10-13): page blurbs and recruiting-season clauses (extractor 1.16.34–1.16.35)

- 1.16.34: a meta description that invites the reader to the page ("Learn about the history, mission, and values of …", "Meet the students …", "Discover …", "Explore …") is a search blurb, not a one-liner. Every page was replayed offline, and `retract-unreproduced --field=club.short_description` rejected 13 claims at 11 clubs. ICMUN has no one-liner left.
- 1.16.35: in a sentence of several clauses, recruiting seasons come only from the clauses about joining, and "the following Spring" counts as a season. "The competition takes place each Fall, and recruitment occurs the following Spring" now gives spring (the Fed Challenge had shown fall).
- Fixtures: `packages/pipeline/test/extract.test.ts`.

## Amendment (2026-10-12): one Facebook page, one entry

Search finds the same Facebook page under several addresses: `/p/<Name>-<id>`, `/people/<Name>/<id>`, `/<id>`, and the page's renamed `/p/` slug (Tamid, HULC, Model Congress San Francisco). `pickLinkBar` now treats links with the numeric page id of the Facebook icon (`facebookPageId`) as that icon, so the duplicates no longer fill "More links". The claims themselves are unchanged.

## Amendment (2026-10-13, resolver-v18, press-v5, extractor 1.16.38)

- **Activity fold**: lines with the same named program before a colon ("Startup Series: …"), lines whose words are three quarters inside a fuller line, and equal lines one generic noun apart ("staff positions"/"staff roles") show once. Board elections are governance, not activities (`governanceActivityProblem`: grounding g17 and audit `description.activity_governance`).
- **Press-v5**: a mention is dropped when its headline names another indexed club and neither the headline nor the start of the sentence names this one, and no distinctive word of this club's name is in the headline (the Debate Council's investigation on the Debating Union's page).
- **Link labels**: "here", "click here", "this form" are no label (Kuumba's form).
- **Missions**: a paragraph over 400 characters gives only its sentence that states the mission ("Our mission is …"), and a lead-in ending in ":" gives none (The Crimson's diversity paragraph). Hours per week: a meeting's own length ("We meet every Tuesday for 1 hour") is not a weekly commitment (rejected; the registry has no meeting qualifier).

## Amendment (2026-10-13): retiring old LLM output after the g17 replay ($0 spend)

`retract-unreproduced --extractor=site-llm --version=club-extract-v4+g17` (no field filter) listed 1,657 claims: 1,051 activities, 288 one-liners, 179 missions, 98 experience statements, 22 sponsors, 11 stage lists, 4 member counts, 2 eligibility, 1 applicant count, 1 recruiting season. Almost all came from older prompts and groundings (v3, v4+g3…g15). Of the 645 not read on a club's own page, 639 still found their quote verbatim on the latest copy of the page. They were model wording drift, not facts the pages had dropped. Nothing pointed to a replay or grounding bug.

Owner decision (2026-10-13): what clubs say about themselves is trusted. Claims read on the club's own pages are retired only when they repeat another value of the club. Claims read anywhere else (directories, Wikipedia, other sites) follow the normal rule.

- **`retract-unreproduced --club-sources=only|exclude`** limits candidates to claims read, or not read, on the club's own pages. A club's own page is an established club channel (tiers 2–5), a source the club owns, or a page on the host of the club's linked website whose ownership isn't established yet (216 such claims, for example harvardmicrobiologysociety.org and harvardcombatsportsclub.com).
- **Re-read means the same club.** A newer copy of a page counts as re-read only if the current version left evidence there for the same club. A shared page's evidence for a neighbouring club says nothing about whether this club's cached chunk was read. This did not change this run's count.
- **Run:**
  - `--club-sources=exclude` retracted 431 claims (pbha.org, iop.harvard.edu, the career center's pages, Wikipedia).
  - `--club-sources=only --only-restated` retracted 614 claims. The rest of that bucket (612) stays.
  - Six claims were restored by hand after reading the projection diff. Each was the only statement of its fact and is still verbatim on its page: the EAC and HFIMRC missions, HUB's 80+ members, Model Congress's about-200 undergraduates, and Science in the News' graduate eligibility.
  - Rejected a Wikipedia fragment that had become the Review of Philosophy's one-liner ("which publishes professional[clarification needed] philosophy").
  - Southie After School's "No comp. Volunteers need …" stays retracted, because its quote doesn't say "no comp".
- **Display:** 226 values changed at 162 clubs: 140 activity lists, 49 missions, 16 one-liners, 13 experience lines and 8 sponsor lists. They are almost all rewordings, or a list dropping a second wording of the same item. No club lost its only one-liner, mission, joining, date, eligibility or size fact, or any club-sourced fact. Sponsors gone: "PBHA" on six PBHA programs and "Work Force Youth Program". Some activities read only on directory or Wikipedia pages are gone (for example the Krokodiloes' television and radio appearances).
- A later full run would retract the six restored claims again. Run the non-club bucket with a field filter, or review its dry run first.

## Amendment (2026-10-13): press-v6, mentions judged on the whole article

Student testing round 4 found "In the news" listing stories about other organizations. The HPR and HPU listed IOP board announcements. The Republican Club listed Salient pieces. Passing mentions appeared too: the Psychedelics Club in an HUA spending story, CIVICS in a Marshall Scholarship story, and the Votes Challenge in "Trump Returns to Office".

- **The article, not one sentence.** `articleSignals` reads the stored article and returns how often it names the club and whether the opening paragraph does. Names count in their full forms, without a leading "Harvard"/"College"/"Undergraduate" ("the Republican Club"), and by acronym or initials ("the PSC"). Initials count only in an article that also spells the name out. Photo credits and bylines don't count. The opening is about the first 300 characters of prose after the byline and credits.
- **Passing mentions.** When the headline doesn't name the club and the article is at hand, the club must be in the opening paragraph or named at least twice. This applies whatever the name's length.
- **Umbrella organizations.** A headline about the IOP, PBHA or the HUA (full name or acronym; the Undergraduate Council only by full name) never flows to another club unless that club is in the headline.
- **Another club in the headline.** A one-word club name counts when written "Harvard X" ("… Shut Down The Harvard Salient"). With the article at hand, the exemption for the club named at the start of the quoted sentence now needs the club in the opening paragraph.
- **Old articles.** Nothing from before 1990 is shown, even with the club in the headline. Those are 1880s–1890s stories about fencing, cricket and shooting teams (and 1964 Lampoon pieces).
- `press --rescore` reads the stored articles (snapshot store, no network). Mentions without a stored copy keep the press-v5 rules.
- **Measured** (dry run, 943 active mentions): 247 would be rejected. 194 are single passing mentions, 27 are pre-1990, 22 are umbrella-organization headlines and 4 are another club's headline. By club: HPR 4 → 0, HPU 5 → 4, Republican Club 15 → 11, Psychedelics 3 → 2, CIVICS 1 → 0, Votes Challenge 13 → 6, Fencing 4 → 0, Cricket 4 → 2, Shooting 3 → 2.
- The profile already shows 5 articles and folds the rest behind "Show all N articles" (`PRESS_SHOWN`, apps/web).
