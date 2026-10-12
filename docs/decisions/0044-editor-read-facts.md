# 0044: Editor-read facts for high-traffic clubs

**Status:** accepted (M3)

## Context

A review of the live site on 2026-10-02 found that the clubs students check first were the weakest. For example, the Harvard Crimson had no website on file and "Joining: Unknown". Across 705 clubs, hours per week were known for 2%, member counts for 5% and first-year eligibility for 9%. The crawler and extractors had already read the pages they could reach, and the `opportunities` report showed the remaining facts are rarely stated where a shallow crawl looks: they sit on a /comp or /join page, in an FAQ, or behind a link the crawler deprioritized.

A person reading a club's pages finds these facts in minutes. But model knowledge and editor memory are not sources (§2.1, §23.8), so a person's reading has to end in the same evidence a crawler would produce.

## Decision

`packages/pipeline/src/curated/facts.ts` lists editor-read facts. Each entry names a club (slug), one page and the facts that page states. Each fact has a registry field, a value and the verbatim sentence that states it. Only club-level fields are allowed: join mode, first-year eligibility, eligible classes, hours, member count, dues, recruiting seasons, experience required and meeting frequency. Dated recruiting rounds stay with the recruiting pass, which owns cycle identity and term rules.

`pnpm hci facts [--dry-run] [--club=a,b] [--file=batch.json]`:

- **Fetch:** the page is fetched with the polite fetcher (robots honored, snapshot stored), exactly like a crawl.
- **Quote:** every quote must appear in the page text (whitespace, quote and dash differences ignored; this is `missingQuotes` from the lifecycle stage).
- **Evidence rules:** every fact must pass the rules the extractors use (`evidence-rules.ts`). Numbers must be literal, a negated process doesn't count ("no auditions" isn't an audition), first-year wording must actually open membership, and dues wording must be about membership. A failing fact is reported and skipped; the rest of the entry is still written.
- **Claims:** a passing fact becomes a `stated` claim. Its extraction method is `manual` and its extractor is `curated-facts@<list version>`, evidenced by the snapshot, with an `editorial_decision` row (`record_facts`).
- **Tier:** the page keeps its own tier. It counts as `club_website` only when its host (and folder, for shared hosts) is the club's **verified** website, and `thecrimson.com` is `harvard_crimson`. Everything else is `public_web`. To give a club's own site its tier, the editor confirms the website in the curated list (ADR 0024), which verifies it by fetching.

`pnpm hci page-text <url>` prints a page's text as the pipeline reads it, after checking robots.txt, so research can copy exact sentences.

## Consequences

- The highest-traffic profiles can be filled quickly without weakening provenance: every value is backed by a stored snapshot and a verbatim quote, and `explain` shows both.
- A page that stops saying something fails the next run. The claim stays until it is retracted (`retract-unreproduced --extractor=curated-facts`) or superseded by fresher evidence.
- These are ordinary claims, so the resolver, the derived joining facts (ADR 0041) and the audit treat them like any other `stated` claim. An editor's misreading is caught by the same rules that catch an extractor's.

## Amendment (2026-10-03): a club's own member count wins

The owner decided that a club's own current count beats a listing that quotes it. The career office showed HUWIB at "700+" while the club's site says "over 400". Fields can now set `ownSourceFirst`. Within one recency window, a claim from the club's own channels (tiers 2–5) then outranks every other tier, including tier 1; a newer stated date still wins. Only `club.member_count` sets it (resolver-v7). On re-resolving, it changed two clubs: HUWIB 700+ → 400+, and the Small Claims Advisory Service 30+ (PBHA page) → 100+ (its own site).

## Amendment (2026-10-03): text fields and the Gazette

Editor-read facts may also carry `club.mission`, `club.long_description` and `club.activity`. Each value must sit verbatim inside its quote, so the text is the page's own words, never a paraphrase. Pages on `news.harvard.edu` (the Harvard Gazette) are `harvard_related_other`. First use: the College Events Board, which has no website.

The same day, the page reader stopped treating a skip link's *target* as junk. WordPress block themes give `<main>` the id `wp--skip-link--target`, and dropping it emptied 14 stored pages, including the Gazette's articles (extractor 1.16.15).

## Amendment (2026-10-12): a subdomain of the verified site is the club's

The Crimson's comp site, `comp.thecrimson.com`, was typed `public_web` because its host isn't `thecrimson.com`, the verified website, so its "No experience needed" fact was written as if from another website. The extractor already reads a subdomain of the club's own site as the club's (1.16.17–18). That rule now lives in `@hci/core` as `isOwnSubdomain`, and the facts stage uses it too: a page on a subdomain of the verified website is `club_website`. It never applies under a path-scoped site (`hbs.edu/foundation`) or a school's shared host (`hbs.edu`, `hcs.harvard.edu`), and the extractor still never applies it on directory pages. Of the 147 listed pages, only the Crimson's comp page changed type. Its source became the Crimson's own tier-2 page (Sources now says "Club website", not "Club recruiting page"), with no displayed value changed. Evidence already written keeps its old confidence, because evidence rows are fixed once written. The comp page states no hours a week, no first-year rule beyond the eligible classes already recorded, and no dues, so no new facts were added. The Business Board's 5–15 hours belong to that separate club, which already shows them.

## Amendment (2026-10-12): student testing, next rounds and joining facts

Student testing found finance and consulting clubs showing "round closed" with no next step, and the HPR with no joining facts. Pages were read with `hci page-text`; a season was recorded only where a page states a recurring pattern, never from one past round.

- **Recruiting seasons.** The Crimson's about page says "Students may comp in both the fall and spring" and lists the Business and Technology boards, so both board clubs get fall + spring (tier 6). HDAG's application page says it holds recruiting events "in the first week or so of the semester" (fall + spring). HUCG's "Our analyst classes each semester…" is now read by the extractor (1.16.27, below), so it needs no entry. HFAC, HIA, HAI, HUVCG, HUREIG, HUCP, CREL and HUMG only name single rounds ("Fall 2026 Comp", "spring 2026 applications"), so they stay unknown.
- **HPR.** Its comp page names a comp only for the tech team ("upon completion of our comp, become a Senior Engineer"); the joining rules have no role for a publication's sub-team, so a comp fact would have read as general membership. It was written once by mistake and rejected (audited). The page does say "We are always seeking new staff writers and contributors", recorded as rolling recruiting, and the IOP page gives its meeting time. The stored comp page was a real 200 page, not a ModSecurity error.
- **WiCS.** Its community page calls the comp "non-competitive and completion based" (six events). That sentence now backs the comp claim, so joining shows a no-cut comp. An `attendance_based` fact beside the comp read as a second, conflicting way in (access "mixed") and was rejected.
- **HUCG stages.** The shown stage list was an LLM reading of the /apply page's recruiting events (info sessions, meet & greet, board chats, written application). It was rejected with `reject-value`, so the competing claim from /application-process shows: written application, first-round interview, second-round interview.

Deterministic extractor 1.16.27–1.16.31, from the same testing:

- A recurring time beside a new intake of members counts as a recruiting season: "analyst/new/member class(es)", "cohort", "welcomes/accepts new members", "to join our cohort". "New members" alone, "join the club" (its seasons may be meetings) and program participants don't.
- "Email list" link text is a mailing list ("Join our New Email List" at WiCS, the Pops' "email list" were shown as application forms).
- "Auditions", "Tryouts" and "Casting" link text is a way in, so 20 clubs’ audition and casting pages (HRMDC, HRDC's Common Casting, the Kroks, the Glee Club…) are their apply links instead of "Check how to apply" at the home page.
- A paragraph that is one quotation in the first person singular is a testimonial, not the club's description (the Kroks' About). Quoted self-descriptions ("“Product Lab is…”") stay.
- On a directory page, a meta description whose subject is another organization introduced with its acronym ("The Institute of Politics (IOP) at…") isn't the club's. It had been the one-liner of six IOP programs; 19 such claims were retracted.
