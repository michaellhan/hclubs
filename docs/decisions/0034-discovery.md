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

## Amendment (2026-10-02): constraint phrases, soft words, precision

Students type constraints into the search box ("no comp finance", "clubs for freshmen", "still recruiting", "social no application", "easy clubs"). Matched as text, they found clubs whose descriptions happened to contain "no" and "comp", and spelling correction turned "easy" into "east" and "still" into "skill".

- **Constraint phrases become filters** (`local/constraints.ts`, `effectiveQuery` in `search.ts`). A fixed phrase table maps to the existing yes/no/unknown filters: First-years eligible, No comp, Open membership, No dues, Recruiting now. They read the derived joining facts (ADR 0041), so unknown never counts as yes. The phrase and the words that only introduce it ("that are", "for") leave the text. `searchLocal` returns `constraints`, `searchedText` and `soft` so the directory can say how it read the query. `facetCounts` and `relaxations` use the same reading.
- **A name wins.** When the whole query is a phrase of some club's name ("first year outdoor program", "easy rider"), nothing is read as a constraint.
- **Soft words** ("beginner", "casually", "for fun", "low commitment", "no audition") are things clubs rarely state and no filter covers.
  - Beside a topic they stop being required words and re-rank. A club ranks higher when its text says the word, or when a joining fact answers it: no experience needed, open membership, no cuts, or at most 5 stated hours a week.
  - A stated audition or tryout counts against "beginner", and a comp against "low commitment".
  - Alone ("low commitment", "beginner"), they select only clubs that answer them. Only 14 clubs state their hours, so these lists are short on purpose.
- **Precision:**
  - An abbreviation finds its full form in a description ("vc" finds "venture capital", "ml" finds "machine learning"), but an expanded form among listed activities counts only as a topic.
  - A single related word that appears only in a club's activity list no longer matches on its own: "games" at a dance team's football games, "camping" at a summer day camp. A specific related phrase ("machine learning") still does.
  - Concepts can name related words that count only in names (`nameOnly`; "Outing Club", not "monthly outings").
  - The finance concept dropped "equity" ("Menstrual Equity"). The social concept has no related words ("Tech for Social Good"), and games names the kinds of games instead of "games".
- **New phrasings:** a "Building & making" concept ("build things", "maker"), and "meet people" / "make friends" as Social. Demonym ↔ place variants ("chinese" ↔ "china", "korean" ↔ "korea"); broad pairs such as "asian"/"asia" are left out.
- **Typeahead helper:** `suggest(clubs, q, n)` (`local/suggest.ts`) matches names only: acronym, name prefix with or without the "Harvard" words, alias, initials, a word inside the name, and one slip from 5 letters. It ranks ended and graduate groups lower, never returns defunct ones, and takes about 1–3 ms over the index.
- `cleanQuery` strips control characters before searching.

Rejected alternative: hand-tuning queries one at a time, or reading every "no …" as a negation. The phrase table is small and explicit, and each entry maps to a filter the directory already explains.

## Amendment: "Meet people" intent and Postgres constraint parity (2026-10-02)

- `meet-people` (group "Serve, argue & belong"): clubs in Social or Cultural & Identity, or whose name/description says "make friends", "social events", "building community" and similar phrases. It leaves out invitation-only clubs, governance bodies (house committees) and social organizations (final clubs, secret societies) that don't say membership is open (`isSelectiveSocial`). Under "Best match" it lists open membership first, then no-cut clubs, then the rest (`Intent.rank`). Same rule for everyone, not a recommendation.
- `PostgresSearchProvider` now reads constraint phrases with `interpretQuery` ("no comp finance" = No comp + "finance") unless the whole query is part of a club name, as the browser does. Soft modifiers are not applied in Postgres.
