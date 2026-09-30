# 0026: Coverage depth: press mentions, estimated categories, recruiting patterns

**Status:** accepted (M3)

## Context

After ADRs 0024–0025 the index listed about 420 clubs, but profiles were thin:

| Field                  | Coverage |
| ---------------------- | -------- |
| How to join            | 29%      |
| Recruiting dates       | 8%       |
| Hours per week         | 2.5%     |
| Categories (new clubs) | none     |

Students also asked when clubs usually recruit, and whether a club is still around.

## Decision

- **Press mentions** (`club.press_mention`, multi, tier 6/7). The `press` stage finds articles about each club and keeps an article only when its text contains the club's full name. Candidates come from `site:<publication> "<name>"` through the search API for the Crimson, and from the publication's own WordPress search API for the Independent and the HPR (ADR 0027).
  - **What we store:** the headline, date, publisher and link, never article text (§21).
  - **Evidence quotes:** we prefer a sentence that names no student; otherwise "Name ’25" is redacted to "[a student]" (no rosters or officer names, §4).
  - **Activity:** a mention within a year counts as an activity signal (`activity-v2`, ADR 0020).
- **Estimated categories.** `categorize` asks the model to pick 1–3 taxonomy slugs for clubs that have no category, or that have a top-level category but no subcategory. Each pick must quote a stored snapshot of the club's description; ungrounded picks are dropped.
  - Claims are `inferred` (registry `allowInferred`) and display with the Estimate badge.
  - A subcategory also writes its parent.
- **Recruiting pattern** (`club.recruiting_seasons`: fall/spring/summer/winter/rolling). This is a club-level pattern (§8), separate from dated cycles.
  - The deterministic extractor accepts only recurring phrasing ("every fall", "each semester", "rolling basis") in a recruiting context. It ignores single instances ("Fall 2026").
  - The LLM prompt (v4) has the same rule, and grounding requires each season to be named in the quote.
- **Wider LLM coverage.** Up to 6 pages per club, of any role except team/contact/sponsors, with joining pages first. Team pages are never sent (people).
- **Harvard-hosted club sites.** Verified links on `*.harvard.edu` subdomains at least 4 labels deep (e.g. `ewb.hsites.harvard.edu`) are crawled as club sites; portals and bare department hosts never are.

## Consequences

- **Categories are estimates**, and the UI now labels every inferred category as such (previously they looked verified).
- **Recruiting patterns** power "Usually recruits this term" on /recruiting and a directory filter. They are never shown as deadlines.
- **Crimson coverage** is limited by web-search credit. The first run covered about 75 clubs before the prepaid Brave credit ran out.
