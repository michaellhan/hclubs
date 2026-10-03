# 0035: Contribution workflow — typed prefilled forms, per-field review, evidence links, comp-report groundwork

**Status:** accepted

## Context

Community contributions now fill gaps the public web can't: recruiting dates, how a comp works, hours, dues. The site is still a static export with no server or accounts (ADR 0022), so contributions arrive through one Google Form and are imported from its CSV export (ADR 0027).

An audit of that flow (2026-10-01) found these weaknesses:

- **One generic link per profile.** "Suggest an edit" prefilled only the club's slug. The submitter had to pick a type and write free text. The form's Details question had no structure, so every response needed the editor to work out the field and type the value by hand.
- **`/contribute` asked for the same free text** as every other link.
- **All-or-nothing review.** `submissions accept <id> --field --value` recorded one field and closed the submission. A response with three facts (one right, one wrong, one unclear) couldn't be partly accepted. There was no `show` command and no record of which parts were rejected.
- **Wrong provenance.** The community claim's source was the submitter's evidence URL. If that URL was already a known club-site source, `upsertSource` kept its tier 2. A tier-9 student report then looked like the club's own page, which contradicts §7.1.
- **Evidence links were never fetched or checked.** A link the student supplied added no confidence even when the page stated the fact.
- **Silent replacement.** For recency-first fields (member count, deadlines, activity status), a new student report could replace an older value from the club's own page without the editor seeing it.
- **Weak club matching.** Only an exact slug or exact name worked. Typos, renamed slugs, merged clubs and aliases fell through with no suggestion.
- **Too few kinds.** Only four existed (`edit_suggestion`, `link`, `deadline`, `inactive_report`).
- **Personal data.** Email columns were dropped, but email addresses and phone numbers typed into the answer text were stored.
- **Copy described buttons that no longer exist** ("Share what you know", "Run this club?").

## Decision

### Typed, prefilled contribution links

`@hci/core/contribute.ts` defines the contribution types: missing info, something wrong, website, Instagram, deadline, application link, how to join, members, dues, time commitment, who can join, inactive, renamed, listed twice, I run this club, other. Each type has:

- **A form option.** This is the live form's "What kind of update?" answer the link preselects. It must match an existing option exactly, and a test pins the list.
- **An answer template.** Short `Label (hint): ` lines prefilled into the Details question, for example `Dues (amount and how often, or none): `.

The form URL in `NEXT_PUBLIC_CONTRIBUTE_FORM_URL` takes these placeholders:

- `{clubref}`: "Club Name [slug]", readable and robust to edits.
- `{club}` and `{slug}`.
- `{type}`: the form option.
- `{details}`: the template.

The links carry no internal IDs. Profiles end with **Help improve this page**:

- **Chips.** One chip per type. Fields the page lacks come first, as "Add dues"; known fields read "Update dues".
- **"More".** A disclosure holding the rarer types.

On `/contribute`, "Add info" opens the missing-information template: what the club does, website, Instagram and how to join.

The Google Form itself is unchanged. Adding the precise types as options (Instagram, Application link, Eligibility, Renamed, Listed twice) would only change `formOption` values; the import already reads the type from the answered template lines.

### Import produces reviewable proposals

`submissions import <csv>`:

- **Rows kept and dropped.** Each response is stored as a `pending` `student_submission`. "Feedback about the site" responses are skipped.
- **What a submission stores.**
  - Its raw non-personal answers by question.
  - The submission time, parsed from Google's campus-time timestamp.
  - The target club, plus the type.
  - The evidence URL.
- **Club matching.** In order: `[slug]`, a profile link, slug history, the surviving club after a merge, the name, then a unique alias. When nothing matches, the import suggests the nearest slug (`match <id> <slug>` fixes it).
- **Repeats.** Re-importing the same export does nothing (content key). The same text sent again for the same club is kept but flagged `duplicateOf`.
- **Personal data.** Columns naming the submitter (email, name, phone, NetID, HUID, class year) are never read. Emails and phone numbers in answer text are replaced with `[email removed]` / `[phone removed]` before storage. No submitter reference is stored.
- **Proposals.** Each answered template line becomes a `submission_proposal` row: field key, label, raw text, parsed value (or null with a note), term key and position.
- **Parsing.** Parsers are deterministic and return null rather than guess:
  - Numbers and dates must be present in the text.
  - "about 40" becomes a range.
  - "no audition" is not an audition.
  - A single "inactive" report proposes `possibly_dormant`, never `inactive`.
  - A deadline without a term takes the term its date falls in, flagged "confirm".
  - "Listed twice" proposes a merge candidate, never a merge.

### Review CLI

```
submissions list [--status=…] | show <id> | accept <id> | accept-field <id> <field|#> [--value] [--term] [--override]
submissions reject-field <id> <field|#> --reason=… | reject <id> --reason=… [--spam] | match <id> <slug> | stats
```

- **Short IDs.** IDs can be given as the last 8 characters. UUIDv7s made in the same millisecond share their first 8.
- **`show`.** For each proposed field it shows the raw answer, the parsed value, what the profile shows now and from which tier, and a ⚠ when they differ.
- **`accept-field`.** `--value` overrides the parsed value or adds a field the free text mentions. The legacy `accept <id> --field --value` still works.
- **Rejections.** Each one needs a reason. The submission's status follows its proposals: `accepted`, `partially_accepted` (new enum value) or `rejected`. Nothing is deleted.
- **Audit trail.** Every decision writes `editorial_decision` rows with the timestamp, reason, value and resulting claim IDs:
  - Per field: `submission_field_accepted|rejected`.
  - Per submission: `submission_<status>`.
  - Re-matching: `submission_matched`.

### Claims, evidence and conflicts

- **The community claim.** An accepted field is always a `user_reported` claim. Its source is the single "Community submission" source (`https://hclubs.app/about#contribute`, tier 9) and its evidence row references the submission. It is never sourced from the submitter's URL.
- **Evidence links** (`stages/submission-evidence.ts`). When the submission has a link, accepting a field fetches it like any source: polite fetcher, robots.txt, an immutable snapshot and a fetch attempt.
  - **Never fetched.** Social platforms (§21).
  - **Forms.** Reduced to title and public description first (ADR 0027).
  - **Source type.** A URL already known keeps its type. One on the club's verified website host is `club_website`, thecrimson.com is `harvard_crimson`, harvard.edu is `harvard_related_other`, and anything else is `public_web`.
  - **The value check.** It uses the same evidence rules as the extractors (`evidence-rules.ts`): numbers literal, dues about membership, "open" about joining. Deadlines are parsed date expressions on the page; links must be links on the page; text must appear verbatim. Some fields can't be checked mechanically (freshman eligibility, activity status), so they stay community-only.
  - **When the page states the value**, a second `stated` claim is written from that snapshot at the page's own tier, with the verbatim quote (`submission-evidence` extractor, method `manual`). Corroboration therefore raises confidence only through a real, independently fetched source. With no link, or no match, the fact stays student-reported.
- **Conflicts.** Before writing, `previewFieldResolution` runs the pure resolver with the new claim added:
  - **Sourced value stays shown.** The community claim is kept as a competing claim ("kept as a competing claim; still showing $20 (club_website, tier 2)").
  - **The community value would replace a sourced value.** Acceptance is refused unless the reviewer passes `--override`; the override is recorded in the decision payload. The exception is when the evidence link corroborated the value: then the sourced claim competes on that page's own standing.
  - **Unchanged.** The resolver and its tie-breaking are not modified.

### Anonymous comp reports (groundwork, display off)

- **Table.** `comp_report` holds the club, optional cycle, term, track, coarse class year, applied, furthest stage, accepted, approximate applicants, approximate cohort, hours spent, notes (moderation only) and status.
  - **Dates.** Day-precision only (`reported_on`).
  - **No identity.** There is no submitter, user or contact column. A test pins this.
  - **Check constraints.** Class-year values are limited; a report that didn't apply can't have an outcome; counts must be positive.
- **Input.** `CompReportInput` (Zod) validates reports.
- **Aggregation.** `aggregateCompReports` (pure, `comp-agg-v1`) applies these rules:
  - **Display is off.** `displayEnabled: false` until M6.
  - **Minimum reports.** Below 5 reports for a club cycle, nothing is returned, not even the count.
  - **Sample size.** The report count is always part of a shown aggregate.
  - **Admitted share.** It needs 10 reports with a known outcome and at least 3 on each side, so a 0% or 100% band (which would reveal everyone's outcome) is never shown. It is a 10-point band and labelled as a share of reporters, never an acceptance rate.
  - **Stages.** Groups under 3 are hidden; hidden ones count only as one total, and only when that total is at least 3.
  - **Medians.** Applicants and cohort are rounded to two significant figures, hours to the nearest 5, and each needs 5 answers.
  - **Never returned.** A class-year breakdown, notes or individual reports.
  - **Kept separate.** Aggregates carry `source: "community"`, separate from club-published `cycle.applicants/admits`, with the `COMP_COMMUNITY_LABEL` disclaimer.
- **Accepted reports only.** `compAggregateFor` aggregates moderator-accepted reports only.

## Consequences

- **Structured answers.** Most responses arrive with proposed values; the editor confirms per field instead of transcribing.
- **Community claims stay at tier 9.** A student report can't masquerade as a club or Harvard source, and a sourced value is never silently replaced.
- **Network use.** Accepting a field with a link costs one polite fetch. `--no-fetch` skips it, for offline review.
- **Metrics.** `submissions stats` reports pending, accepted, partial, rejected and spam submissions; proposals by status; accepted fields; clubs improved; links that confirmed a field; profile fields showing a community value; and unmatched submissions.
- **Before Harvard-authenticated submissions (M5/M6):**
  - A server endpoint.
  - Harvard email verification (magic link).
  - Rate limits keyed by an HMAC of the verified identity, in a separate table rotated per cycle (`SUBMISSION_HMAC_SECRET`).
  - A comp-report form that writes `comp_report` directly.
  - A moderation queue UI.
  - Club-manager verification through the club's official channel.

  Until then, comp outcomes aren't collected through the open Google Form, because it can't stop one person reporting many times.

## Amendment (2026-10-03): on-site suggest form

The owner asked for every form topic on the profile without a cluttered chip cloud, and for students to fill answers in on the site like the officer form (ADR 0045).

- **`/suggest?club=<slug>&topic=<type>`** asks the chosen topic's template prompts as fields (links as URL fields, explanations as text areas) plus an optional "Where did you see this?" link. It sends nothing itself: "Continue to send" opens the contribution form prefilled with the club, the topic's form option and `Label: value` lines (`suggestDetails`, `apps/web/src/lib/suggest.ts`). Blank fields send no line.
- **Profile:** "Help improve this page" lists every topic in two labelled rows, Add (facts the page lacks first, marked +) and Report, plus "Run this club? Update its page" → `/for-clubs`. The "More options" fold is gone. `ContributeLink` (profile "Unknown" links, `/contribute`) opens the suggest form too.
- **Importer:** the form's own source question can't be prefilled, so the link travels as a `Where this is posted:` line; `postedLink` reads it as the submission's evidence URL when the source column is empty.
