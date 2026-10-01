# 0034: Discovery for students who don't know club names

**Status:** accepted

## Context

With about 710 clubs, the hard question is no longer "find the club I know" but "which clubs are relevant to what I want to do?" The client search ranked names well but failed on topics:

- **Topic queries missed.**
  - "volunteering" found one club, the Mountaineering Club.
  - "journalism" missed The Crimson.
  - "newspaper" found one club.
- **Fuzzy noise.**
  - "coding" and "cooking" returned unrelated clubs (peer counseling, cheerleading).
  - "chess" returned Chemistry, "climate" returned Climbing, "quant" returned Quadball.
- **Buried categories.** Technology, medicine and startups sat under "Pre-professional", and several categories had only a handful of clubs.

The site must stay a static export with client-side search, with no accounts, no personalization and no chat interface.

## Decision

- **Search (`@hci/db/local/search.ts`).** A transparent model with named weights (`WEIGHTS`).
  - **Query parsing.**
    - Phrases from the concept table are recognized first ("model united nations", "a cappella").
    - Filler words such as "harvard" and "club" are dropped.
    - A word the index has never seen is corrected to the nearest known word: one edit, or two for words of 8 or more letters. "Showing results for…" is reported only when the correction found something.
  - **Matching.** Every query unit must match. A plain word scores on acronym > name word > name prefix > description word > tag/activity word.
  - **Concepts.** A concept scores in tiers that add up: the word as typed (in the name, else the description), else a related word in the name; plus the concept's category; plus a related word in the text.
  - **Whole-query bonuses.**
    - Exact name, exact acronym, or name prefix.
    - "Core name": the name without filler words equals the query, so "crimson" finds the Harvard Crimson.
  - **Tie-break.** Completeness.
  - **Shown on rows.** Each result row says which text it matched ("Matched: mentions “software”").
  - **Postgres parity.** `PostgresSearchProvider` (dev only) keeps its simpler text ranking. Parity tests still pin the filters, and the exact-name/acronym-first rule.
- **Concepts (`concepts.ts`).** About 30 hand-written entries, each with trigger terms, related words and categories. For example:
  - consulting ↔ strategy
  - finance ↔ investing
  - startups ↔ entrepreneurship
  - volunteering ↔ public service
  - newspaper ↔ journalism
  - theater ↔ theatre
  - coding ↔ software ↔ CS
  - AI ↔ artificial intelligence

  Lists are kept short on purpose. "community", "students" and "health" were removed from broader concepts because they made results noisy. A test checks that each trigger term belongs to exactly one concept.

- **Categories.**
  - **Renamed for browsing.** Business & Pre-professional, Technology & Engineering, Health & Medicine, Academic & Research, Arts & Performance, Politics & Policy, Sports & Recreation, Social & Community.
  - **Moved to the top level.** Technology, Health & Medicine and Entrepreneurship.
  - **Slugs unchanged,** so claims and their provenance are untouched.
  - **Name-settled categories.** `pnpm hci categorize --from-names` adds categories a club's own name settles, as `inferred` claims (estimates) whose evidence is the listing that named the club. It uses explicit rules plus exceptions; "Ventures", "Debating Society" alone, "nursing homes" and "Life Science and Technology" are excluded. It added 42 categories; Health & Medicine went from 6 to 22 clubs and Technology from 25 to 38.
- **"What do you want to do?" (`intents.ts`).** 18 fixed rules ("Build software", "Volunteer", "Invest or manage a fund", …).
  - **Rule.** A club matches if it is in one of the rule's categories or its name/description uses one of the rule's words. Activity lists are deliberately not used, because "workshops on survey software" doesn't make a software group.
  - **Where.** The `do=` URL parameter. Every list page states its rule and says it is not a recommendation.
- **Presets.** The home page links to ordinary directory URLs with counts. A preset with fewer than 10 clubs is hidden.
  - **Open membership.** "No comp or application" is the `open=1` filter: a stated open or attendance-based join mode, or the College directory's "no comping requirement" flag, with no selective mode stated.
  - **Low commitment is not offered.** Only 5 clubs state 4 hours a week or less.
- **Directory rows.** Rows add a "No comp" pill (from the College flag) and the match reason; the layout stays dense.
- **Thin results.**
  - **No results:** single-word searches, related categories and intents.
  - **One result:** "Clubs like X".
- **Similar clubs (`similar.ts`).**
  - **Score.** A fixed score over shared specific categories (3 each; "specific" means the category has no subcategories), shared broad categories (1 each), description/tag word overlap (Jaccard × 8) and the joining model (0.5).
  - **Exclusions.** The club itself, inactive clubs, graduate groups (for College clubs) and look-alikes (same name once boilerplate is removed, or the same website or Instagram).
  - **Where it shows.** On profiles, with "Compare these →", and on /compare as "Similar clubs you may want to compare".
- **Index.**
  - **Dropped.** Fields the browser never read: activity reasons and confidence, last verified, source count.
  - **Added.** `searchTopics` (tag and activity words) and `noComp`.
  - **Derived in the browser.** Description and category words, once per page.
  - **Result.** Raw size 877 KB → 793 KB; gzip 117 KB → 134 KB (the added text is new searchable data).
- **Analytics.**
  - **What's counted.** GoatCounter events with the event name only ("search", "filter:<field>", "compare-add", "apply-click", "contribute-click"), sent to the existing setup.
  - **Privacy.** No query text, no URLs, no cookies, no profiles.
  - **Mechanism.** Server-rendered links carry `data-track`, and one listener counts them.

## Consequences

- Search stays in the browser.
  - **Parse:** about 1–2 ms.
  - **First search:** about 15 ms (one-time warm-up).
  - **After that:** median 0.8 ms, worst case under 3 ms over 708 clubs.
- New synonyms or intents are one table entry plus a test. A broad entry must be checked against live results before it ships.
- Thin data still limits discovery: about 290 clubs have no description, and only 14 state hours. Better data, not more ranking, is the next lever.
