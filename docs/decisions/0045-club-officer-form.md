# 0045: Club officer update form

**Status:** accepted

## Context

The two editor-read passes (ADR 0044) showed that most clubs' own pages don't say how members join, when they recruit, how much time it takes or what it costs. Reading more pages can't fix a fact nobody has written down. The people who know are the clubs' officers.

The profile's "I run this club" chip opened the generic contribution form with two free-text lines ("The club's official website or Instagram", "What to update"). Every answer then had to be retyped into fields by the reviewer.

## Decision

`/for-clubs` is a structured update form for officers. The profile chip and `/contribute` link to it with the club preselected (`?club=<slug>`), and the footer links to it too.

- **Questions:**
  - how new general members join: anyone can join, or a selection process (application, comp, audition, tryout, invite only), with the steps and the hours during the process
  - whether first-years can join
  - hours per week as a member, dues and size
  - when the club recruits, the next deadline and its term, and the application link
  - website, Instagram, and a page or post that says the same thing
  - anything else students should know
- **Optional answers:** every question is optional. The page lists what the club's page doesn't say yet.
- **No new server or storage.** The static site still sends nothing itself. `officerDetails` (in `@hci/core/officer`, browser-safe) turns the answers into the same `Label: value` lines the importer already parses. The button opens the existing contribution form (`NEXT_PUBLIC_CLUB_MANAGER_FORM_URL`, falling back to `NEXT_PUBLIC_CONTRIBUTE_FORM_URL`, or email) prefilled with the club, the "I run this club" type and those lines. The officer presses Submit there.
- **Review is unchanged (ADR 0035).** `submissions import` turns each answered line into its own proposal, and `accept-field` / `reject-field` decide each one. An accepted answer is a community claim. A "Where this is posted" link is fetched, and a stated claim is added at the page's tier only when that page says the same thing.
- **New template prompts:** "First-years can join" → `club.freshmen_eligible`; "Usually recruits" → `club.recruiting_seasons`; "Where this is posted" and "Anything else students should know" (free text, not parsed).
- **One source for labels.** The labels live in `officer.ts` (`PROMPT_LABEL`) and `contribute.ts` imports them, so the form and the importer can't drift. Tests round-trip a full answer set through `parseProposals`.

## Consequences

- An officer can fill in a page in about a minute, and the reviewer gets one proposal per fact instead of free text.
- Officers aren't verified (that waits for M5's club-manager roles). Their answers carry the same weight as any student report until a linked page confirms them. The page says so: a person reviews every update, and it shows fastest with a link.
- Answers still depend on the external Google Form, sent as a prefilled URL. Single-line answers are capped at 200 characters and "Anything else" at 1,000, to stay within URL and mail-client limits.
- **Review fixes:**
  - "First-years can join" proposes yes or no only for a bare yes/no. "Not sure" or "no restrictions" goes to the reviewer unread.
  - Seasons named only to rule them out ("we don't recruit in spring") are ignored.
  - The officer form option is one constant (`OFFICER_FORM_OPTION`), also used by the `club_manager` type.
  - Changing club clears the answers.
  - Focus moves to the club heading after picking.
  - An unknown `?club=` says so.
  - Without a form or email the page says updates open soon instead of offering a dead end.
