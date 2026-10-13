# 0033: Data-quality audit

**Status:** accepted

## Context

After the coverage work (ADRs 0023–0032) the index held 717 clubs built from many adapters, search, extraction and LLM summaries. Coverage was the goal so far. This decision makes accuracy the goal: fewer wrong facts, wrong links, stale facts and duplicates, and better attribution and confidence. A hostile read of the live data found errors in every area:

- **Wrong links.**
  - A Harvard directory parser attached other clubs' pages to a club (four Business School clubs' pages on one club).
  - Deep links were displayed as their host's root (`sites.harvard.edu`, `hbs.edu`, `hcs.harvard.edu`).
  - Lapsed domains: one redirects to a French company, one is parked for sale.
  - Truncated Facebook URLs (`facebook.com/people`).
  - Accounts that aren't the club's: members' and web designers' accounts, The Crimson's account, an account from Northeastern.
- **Misread facts.**
  - Member counts taken from mailing lists, alumni networks, bylaws quorums and event attendance.
  - A job posting's 39 hours/week.
  - "Free for accepted hackers" recorded as no membership dues.
  - "Auditions are open to all" recorded as open membership.
- **Stale dates.** Recruiting dates whose stated weekday proves the page is from another year ("Saturday, Feb. 26" stored as 2027-02-26, a Friday).
- **Summaries.** Some described the listing ("listed among computer science clubs") or a sub-event (HackHarvard's China program).
- **Duplicates.** The same organization appeared under two sources' spellings: "PBHA … (BRYE) Tutoring" / "BRYE Tutoring", "Skiing (Club Sport)" / "Harvard Ski Club", "THURJ" / "The Harvard Undergraduate Research Journal", "HCURA" / "Harvard Undergraduate Research Association".
- **Resolver.** For recency-first fields (member count, deadlines) the resolver ranked by fetch time. A Wikipedia article re-crawled this week outranked the club's own page fetched last week.

## Decision

- **`pnpm hci audit [--apply] [--check=…] [--check-urls]`** (`packages/pipeline/src/audit/`).
  - **How it runs.** One loader builds an in-memory picture of the database. Pure check groups (links, content, facts, recruiting, logos, press, categories, duplicates, consistency) return findings. Each finding has a severity (critical/high/medium/low), a confidence (high/medium/low), whether the value is displayed, and an optional fix.
  - **Reports.** It writes `data/reports/audit.{json,md}`, and `/admin/audit` shows it in development only.
  - **What `--apply` changes.** Only high-confidence fixes:
    - Claims are rejected with a reason and an `editorial_decision` row (`actor = audit`), never deleted.
    - Duplicates are merged with the existing reversible merge (`pnpm hci unmerge` undoes it).
    - Projections are re-resolved.
  - **Everything else is for review.**
  - **`--check-urls`** requests each displayed logo politely: one request per host per second, with the crawler's user agent. Images that return 404/410 are rejected.
- **Rules a fix may rest on.** Each rule was tested on the live data and on regression fixtures; earlier drafts were tightened wherever they produced a false positive.
  - **Links: the wrong organization.**
    - **Directory pages.** A directory page about another organization: judged by the fetched page's title (CMS slugs survive page copies), or by the slug only if never fetched. A title that is an organization's name must be one of the club's names up to spelling.
    - **Wrong sites.** A website that 404s, is parked, or redirects to a domain naming nothing of the club. A redirect to a Harvard-named domain is a rename and only goes to review.
    - **Not the club's page.** An article, or a Harvard page listing many groups.
    - **Taken-along facts.** When a link is rejected because it is the wrong organization's, facts whose only evidence is that page are rejected with it. A closed form or a dead page was the club's own, so its facts stay.
  - **Links: social accounts and forms.**
    - **Accounts that aren't the club's.** A school's or office's account, a website vendor's account, another university's account, and a person's profile.
    - **Unrelated handles on the club's own site.** A handle found on the club's own site that shares nothing with its name, acronym or initials.
    - **Shared links.** A link shared with a club it clearly names.
    - **Broken page URLs.** A Facebook URL that isn't a page (`/people`, `/share.php`, `/recover`).
    - **Closed forms.** A Google Form that says it no longer accepts responses.
  - **Facts.** One shared rule set (`extract/evidence-rules.ts`) is now applied by the deterministic extractor (1.7.0), by LLM grounding (`g5`) and by the audit:
    - A member count must count members, judged from the words around the number.
    - Hours over 30 or from a job listing are not a club commitment.
    - Dues must be membership dues.
    - "Open" must be about joining, not an event or an audition.
    - A stated weekday must match the stored date.
    - An open rehearsal, party or shift deadline is not an application window.
  - **Content.**
    - Text that describes the listing.
    - Page furniture: cookie, legal, navigation, subscription and placeholder text.
    - A person's bio.
    - A summary that has no anchor, whose anchor isn't on its page, or that is anchored to another club's page.
  - **Duplicates.** Merged only when:
    - the names are equal after normalization (spelling, plurals, "&"/"and", Harvard prefixes, "PBHA's", "(Club Sport)", and an "(ACRONYM)" expansion);
    - one club's projected alias is the other's name;
    - one club's description is only the other's name; or
    - the two share a link and one club's whole name is the other's handle.

    Merges never touch a pair a person already decided. Shared links, initialisms, "name plus one word" and identical text are only proposed.

  - **Consistency.**
    - Active claims with no evidence.
    - Overstated confidence: more than the tier and method allow. Extractors may down-weight, never up-weight.
    - A projection showing an inactive claim.
    - Facts whose only source is a website rejected for that club. This covers only club-site source types; a Harvard directory or news source is independent of the club's site.
- **Review only, never fixed automatically:**
  - Wikipedia markers and lowercase fragments (cleaned on display).
  - Unrelated-looking handles not found on the club's site.
  - Shared links between related groups (the Hasty Pudding organizations, men's/women's teams).
  - Summary specifics missing from the anchored page.
  - Overclassified or listing-only categories.
  - Favicons and tiny or photo-like logos.
  - News quotes cut before the club's name (the press stage keeps 240 characters).
  - Acronym collisions.
  - Possible national-organization text.
- **Display.**
  - Deep links on shared hosts (`*.harvard.edu`, `hbs.edu`, CampusLabs, iGEM) stay as they are; Wix user sites keep their site path.
  - `cleanDescriptionText` strips Wikipedia markers and capitalizes fragments on display; stored claims keep the exact quote.
- **Resolver v2.** For recency-first fields, an undated claim's observation time counts only at the granularity of the field's staleness window (30 days for volatile fields, 180 for semester ones). Within a window, tier decides. Stated as-of dates still compare exactly. Bucketing keeps the order transitive and deterministic.
- **Summaries (`summary-v2`).**
  - **Prompt.** Describe the organization, not the page or list it appears on. Return null for one event, sub-program or chapter. Add no places or partners.
  - **Page choice.** The club's own home page is read first.
  - **Output checks.** `checkSummary` rejects listing text and hype words the source doesn't contain.
- **Facebook URLs.** The link classifier keeps `facebook.com/people/<Name>/<id>` and `/p/<Name>-<id>` page URLs whole, and treats share buttons, hashtags and account recovery as non-pages.

## Results (2026-10-01)

- **Rejected:** 150 claims, by field:
  - 62 links
  - 22 recruiting-cycle facts
  - 20 descriptions and summaries
  - 17 join modes and dues
  - 12 activities
  - 11 member counts and hours
  - 6 logos

  Five facts that came off a closed application form were restored by hand, with an audit row, because history is not an error.

- **Merged (all reversible):** 7 duplicate pairs.
- **Regenerated:** 6 summaries ($0.04).
- **Re-resolved:** all 710 remaining clubs under resolver-v2.
- **Regression tests:** about 40, covering every bug class found, plus the false positives earlier drafts produced.

## Review round (2026-10-01)

Every review-level finding of medium severity or higher was settled with evidence.

- **Checks improved:**
  - **News quotes.** A news quote cut at 240 characters is now checked against the stored article. All 24 such mentions named their club.
  - **Handles.** A handle of "harvard" plus an abbreviation counts as naming the club (`@harvardcap`, `@harvardir`).
  - **Registration dates.** Conference registration dates (early bird, priority, Session I/II) are events, not recruiting. This rejected HMUN's eight delegate-registration "deadlines".
  - **Career-center label.** The career center's listing labels every club "pre-professional". That label is rejected where the club has another category (41 clubs, including the Signet Society, Eleganza and LGBTQ@GSAS).
- **Decided by hand,** each recorded with its source:
  - **Two merges:**
    - The Deaf Awareness Club was renamed the Deaf Awareness Coalition, per The Crimson on 2022-10-18.
    - The HCS AI Group is the Society for AI: the Society's own site links the LinkedIn page titled "Harvard Computer Society AI Group".
  - **Eight links rejected:**
    - The graduate-school Christian fellowship's page on the undergraduate one.
    - HUMAS's page on the GSAS Latinx association.
    - The Glee Club's site on Glee Club Lite.
    - The Harvard Computer Society's account and mailing-list form on the computing contest club.
    - The same mailing-list form shown as an application form.
    - The Crimson's accounts on its business board.
  - **Ten facts rejected:**
    - Five national-organization texts on Scientista.
    - Past dues.
    - Two "open" join modes resting on mailing-list invitations.
    - A sponsor banner used as a logo.
    - A broken logo URL.
  - **Categories added** through the curated list: a cappella for ApiChorus, publications for the Law Review.
- **Kept after review: 56 findings.** `pnpm hci audit-dismiss <slug> <check> [subject] --reason="…"` writes an `audit_dismiss` editorial decision, so the finding stops reappearing. Delete the row to undo it.
  - Handles whose search result or own site names the club.
  - Related organizations that share a site or account (the Hasty Pudding organizations, club soccer).
  - Faithful summary paraphrases ("IOP" → "Institute of Politics").
  - Clubs' own portal pages.

After this round the audit reports 0 fixable and 0 review-needed findings. What remains is low severity: description fragments and Wikipedia markers (both cleaned on display), favicons, five overclassified clubs and one server error.

## Final pass (2026-10-01)

The low-severity findings were settled as well:

- **Junk descriptions.** Five descriptions that were only years ("(1836, 1878)", "founded in 1971.") were rejected by a new junk rule.
- **Overclassified clubs.** Six were trimmed to three top-level categories, dropping the categories with the weakest quotes (9 rejections).
- **Favicons.** All 30 favicon logos were viewed on light and dark backgrounds. Four were rejected: two invisible on white and two generic stock icons. The other 26 are the clubs' own marks and were kept.
- **Display-cleaned text.** Description fragments and Wikipedia markers are cleaned on display, so they are now flagged only in our own generated summaries.

The audit now reports one finding: a club website returning HTTP 500, a watch item rather than evidence that the site is gone.

## Amendment: people named in club text (2026-10-12)

Student testing found a dance company's profile naming people: the About text credited choreographers and alumni with class years ("… (2010)"), and the "mission" was a show blurb ("Spring 2024the eleventh hour…") that ended with two student directors and their class years.

**Why the rules missed it.**

- The extractor's personal-text filter had `\b['’][0-9]{2}` inside a `\b(…)` group, so a class year after a space (" '25") never matched: there is no word boundary between a space and an apostrophe.
- The audit's `names_people` rule only knew leader keywords ("led by", "founded by", "presidents:"), not class years or production credits, and never looked at activities.
- The mission rule took any paragraph with "we aim to", including "At the core of our spring 2024 show, we aim to …".
- `htmlToDocument` dropped `<br>` without a space, and `cleanText` kept zero-width spaces, so lines ran together ("2024the", "hourLife").

**Decision.** One shared rule set in `evidence-rules.ts`:

- `namesPeopleProblem(text, ownNames)`: a capitalized name with a class year ("Jane Doe '25", "(2010)", ", Class of 2025", "AB '19"), a production credit ("Directed by", "choreographed by", "produced by" …), a list of named choreographers, directors, teachers or coaches ("include", "such as", ":"), or a named leader or contact (`namedLeader`, moved here from the audit). A name inside one of the club's own names never counts ("John Adams Society", "Gilbert and Sullivan Players"); organization, place, term and show words are never name words; staff titles before a name ("Music Director …") and notable-alumni lists without class years are left alone.
- `eventBlurbProblem(text)`: text that opens with a term and year ("Spring 2024 …"), or whose statement of purpose belongs to one production ("our spring 2024 show, we aim to …").

Used by the deterministic extractor (1.16.24: short and long descriptions, missions; the personal filter's class-year bug fixed), LLM grounding (`g13`: short description, mission, activities), `summarize` (`checkSummary`), editor-read facts (`factProblem`) and the audit (`description.names_people`, `summary.names_people`, `description.event_blurb`, `summary.event_blurb`, new `description.activity_names_people`). A `<br>` is a space in `htmlToDocument`, and `cleanText` treats zero-width spaces as spaces.

**Live data.** Over 5,201 active description, mission, summary and activity claims the rules flag exactly three, all read and rejected: the dance company's About text and show-blurb mission, and an improv group's member-bio page used as its short description. Recruiting stage labels are fixed stage names and were clean.

**Consequences.**

- The `<br>` fix changes the page text of about a quarter of the pages with cached LLM output (145 of 594), so their next paid LLM run misses the cache.
- A confirm-only re-read (ADR 0051) couldn't match a description whose spacing changed, so `retract-unreproduced` dropped four claims the page still says (restored with an audited reason). Since extractor 1.16.25, confirm-only re-reads match free-text fields (descriptions, mission, activity, eligibility/experience/meeting notes, self-described selectivity) with whitespace and zero-width spaces removed (`looseTextKey`, `stages/enrich.ts`), and add the evidence to the claim the page already backs. They still never create a value. The four restored claims now carry 1.16.25 evidence.
- Press-mention headlines (the newspapers' own titles, linked on profiles) can still name students with class years; they are outside this rule.

## Consequences

- The audit is cheap (about 4 s; `--check-urls` about 1 min) and idempotent. Run it after any ingestion run, and before publishing.
- New checks go in a check group with a regression fixture. A rule may attach a fix only after its output has been read against live data.
- Extractor and grounding changes are versioned (deterministic 1.7.0, LLM `g5`, summaries `summary-v2`, resolver-v2). Claims the audit rejected stay rejected when re-observed, because claim upserts never change status.

## Amendment (2026-10-13): Facebook pages without a username

`facebook.com/p/<Name>-<id>`, `/people/<Name>/<id>` and `/pages/<Name>/<id>` are Facebook's URLs for pages that have no username, as `normalizeSocialUrl` and the finder already read them. `social.not_a_profile` now flags only those prefixes without the page id. `socialHandleOf` reads the handle of a `/p/` URL as the page name, without the id. Two links an earlier `--apply` had rejected (Harvard Cheerleading, WISHR) were restored with `restore-value`.

## Amendment (2026-10-13): student testing round 5

Three shared rules in `evidence-rules.ts`, used by the deterministic extractor (1.16.43), LLM grounding (`g20`) and the audit:

- `announcementProblem` (part of `aboutTextProblem`): a text whose first sentence announces an event or news ("is excited to announce our second … High School Pitch Competition!", "We are pleased to present a new archive…", "Save the date", "Registration is now open") is never a description or mission. Only the first sentence is read, so a description that mentions an event later passes. Audit `description.announcement` (2 claims: VCG's mission, a BachSoc archive notice).
- `socialFollowProblem` (part of `aboutTextProblem`): "Stay up to date … by following us on social media" and short follow-us notices are never About text (the Ballroom team's About, rejected by hand earlier).
- `auditionPrepProblem`: what to prepare for an audition ("Prepare two contrasting pieces …; no sight reading, scales …", "No monologue needed; prepare 1-2 minutes of a song") is not `club.experience_required`, unless the text also speaks of experience or a requirement ("must play violin…"). Audit `description.experience_audition_prep` (8 claims at HRO, BachSoc, Glee Club, G&S).

LLM grounding also makes a stage's kind no more specific than its label (`stageKindFromLabel`): a "Second Round Interview" is an interview, never a case or technical interview (HUCG's second round is a presentation on a mock business problem).

## Amendment (2026-10-13): member bios, donation asks and registration notices

The Ballroom Dance Club's About candidates were a captain's "Hi! I'm Mikayla, a sophomore in Pfoho …", an instructor's "Tola's dance journey …", an alumni-donation ask and "Registration for Harvard Invitational … are now LIVE!" (all rejected by hand). `personalBioProblem` (part of `namesPeopleProblem`: self-introductions, a class with a house or concentration, "<Name>'s … journey/career", a gendered career clause such as "she competes in …", a named career only beside she/he), `donationProblem` (part of `aboutTextProblem`) and registration notices in `announcementProblem` keep them out of descriptions, missions, summaries and activities: deterministic 1.16.45, LLM `g22`, `summarize`, audit `*.names_people`, `*.donation`, `*.announcement`, `description.activity_donation` / `description.activity_announcement`. A name inside the club's own name never counts. Live audit after the change: no active claim trips the new rules.

## Amendment (2026-10-13, round 6): impostor warnings, obfuscated emails, Substack posts, page text

- **About text:** `noticeProblem` (part of `aboutTextProblem`) also rejects impostor/scam warnings ("HMMT does not partner with any organizations connected to competing teams … claiming to represent HMMT"), Cloudflare's obfuscated-email text ("[email protected]", which a reader never sees as an address) and refund policies ("Full refunds will be provided …", HUSAI's mission). Deterministic 1.16.46, LLM `g23`, audit `description.notice`.
- **Substack posts:** `classifyLink` marks a Substack post (`/p/…`, `@user/p-123`, `/home/post/…`) a content item, so the extractor never stores it as the club's newsletter (AIST's reading list linked other people's posts). Audit `link.newsletter_post` rejects stored ones. A link labelled only "here"/"click here"/"this link" shows its address instead (`isJunkLabel`).
- **Page text:** `htmlToDocument` puts a space around block elements after collecting links, so a list item holding `<h3>Application Submission</h3><p>Submit…</p>` reads "Application Submission Submit…", not "Application SubmissionSubmit…" (HUQT). Link labels and contexts are unchanged. 158 of 1,364 stored club pages read differently; 43 of them had cached LLM output, which no longer matches their text hash (a paid run re-reads them; offline replays skip them).
- **Source-garbled text:** HUSAI's career-center description drops a word in the source itself ("whether from a perspective, a policy angle"), so it and the LLM's rewording of it were rejected by hand; the normalizer was not at fault.
