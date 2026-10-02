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
