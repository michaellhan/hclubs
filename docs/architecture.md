# Architecture

How data moves from the public web to a club profile. CLAUDE.md is the specification; this document describes what is **implemented** (through M2) and where it lives.

```
 discover ─► fetch ─► snapshot ─► parse ─► extract ─► entity resolution ─► claims ─► resolve ─► projections ─► web
 (adapter)  (polite)  (immutable) (pure)   (claims)   (conservative)       (+evidence) (pure)   (rebuildable)   (reads only projections)
```

| Stage                   | Code                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Adapter contracts       | `packages/pipeline/src/types.ts`                                                                           |
| Discovery orchestration | `packages/pipeline/src/stages/discover.ts` (`runDiscovery`)                                                |
| Fetching                | `packages/pipeline/src/fetch/http-fetcher.ts`, `robots.ts`, `fixture-fetcher.ts`                           |
| Raw snapshots           | `packages/pipeline/src/snapshots/store.ts` + `source_snapshot` rows                                        |
| Parsing / extraction    | `packages/pipeline/src/adapters/<name>/` (pure `parse`)                                                    |
| Entity resolution       | `packages/core/src/entity/match.ts` (pure) + `packages/pipeline/src/entity/resolve.ts` (DB)                |
| Claims                  | `packages/db/src/write/claims.ts` (`upsertClaim`)                                                          |
| Reconciliation          | `packages/core/src/resolve/resolver.ts` (pure) + `packages/db/src/resolve/project.ts` (writes projections) |
| Search                  | `packages/db/src/search/provider.ts` (`SearchProvider`, `PostgresSearchProvider`)                          |
| Display model           | `packages/db/src/queries/` (`ClubProfile`, `ClubSummary`, `listClubs`, …)                                  |

## Ingestion lifecycle

1. **Run bookkeeping.** Every job creates an `ingestion_run` row (job, adapter and version, options, git SHA). When it finishes, the row gets a status (`succeeded` / `partial` / `failed`), counters and an error summary.
2. **Discover.** An adapter provides seed URLs. Pagination URLs come back from `parse()` as `nextUrls` and are queued, up to the adapter's `maxPages` cap.
3. **Fetch.** `PoliteHttpFetcher`:
   - identifies itself honestly (`CRAWLER_USER_AGENT` + `CRAWLER_CONTACT`)
   - checks robots.txt, cached per origin for 24h. A robots.txt that fails with 5xx or is unreachable means "disallow all" (RFC 9309).
   - sends one request at a time per host, spaced by `max(CRAWLER_MIN_INTERVAL_MS, Crawl-delay)` plus jitter
   - sends conditional GET (`If-None-Match` / `If-Modified-Since`) using the previous snapshot's validators
   - retries 408/425/429/5xx and network errors with exponential backoff, honoring `Retry-After`
   - enforces a 10 MB cap, a timeout and a content-type allowlist
   - never logs in, solves CAPTCHAs or evades blocks

   Every attempt is recorded in `fetch_attempt`.

4. **Snapshot.** Raw bytes are gzip'd into a content-addressed `SnapshotStore` (`data/snapshots/sha256/ab/cd/<sha>.gz`, written atomically, write-once). `source_snapshot` stores the metadata, the hash, the storage key and the extracted visible text. Identical content for a source reuses the existing snapshot row. On 304 Not Modified, the previous snapshot is re-parsed and the observation time advances.
5. **Parse / extract.** The adapter's pure `parse(page)` returns `DiscoveredOrganization[]`: a stable `externalKey`, identity signals (URLs, external ids) and `ExtractedClaim[]`, each carrying `assertionKind`, `isDirect`, `extractionMethod`, a verbatim `quote` and a `locator`. Deterministic HTML parsing only; LLM extraction is not implemented yet (rules in CLAUDE.md §11.3).
6. **Entity resolution** (per organization, inside a transaction). See below.
7. **Claims.** `upsertClaim()` validates the value against the field registry, normalizes and hashes it, and upserts the claim and one evidence row. Invalid claims are rejected and counted without failing the organization.
8. **Reconcile.** `resolveClubs()` runs for every club touched in the run, each in its own transaction. One failing club never aborts the run.
9. **Index.** The resolver rewrites `club_search_document` as part of step 8.

Failure isolation: a page failure skips that page. An organization failure rolls back that organization's transaction. A resolve failure is recorded per club. A run with no successfully fetched content is `failed`; any errors make it `partial`.

Idempotency is tested (`packages/pipeline/test/discover.test.ts`). A second run over unchanged pages adds no clubs, mentions, claims, evidence or snapshots.

## Provenance model

- **Source:** a logical URL (`source.normalized_url` is unique) with a `source_type`, a `trust_tier` (1 = official Harvard … 9 = student submission), a publisher, and optionally an `owner_club_id` once it is established as a club's own channel.
- **Snapshot:** an immutable fetched version of a source.
- **Claim:** one assertion `(subject, field, normalized value, term, assertion kind)`, e.g. "club X has `club.member_count = {exact: 55}`". Assertion kinds are `stated`, `inferred`, `computed`, `user_reported` and `editorial`. Claims are never deleted; `status` can be `superseded`, `retracted` or `rejected`.
- **Evidence:** each observation of a claim, recording source, snapshot, observed time, verbatim quote, locator, extraction method, extractor and version, confidence (a computed rubric, `packages/core/src/confidence.ts`), and whether the value was stated directly. The same value from two sources is **one claim with two evidence rows**. Different values are **different claims**, so conflicts are preserved.
- **Computed values** (acceptance rate) and **derived classifications** (selectivity label, rule set `selectivity-v1`) are computed at read time from claims and labeled as such in the UI. They are never stored as claims.

## Claim reconciliation

The pure resolver (`resolveField`, version `resolver-v1`) works per field:

1. **Eligibility.** Only `active` claims within `valid_from`/`valid_until` count. `inferred` claims count only if the field's registry entry has `allowInferred`, which is false for numbers, dates, money and eligibility.
2. **Ordering.** Editorial claims come first. Then the field's strategy applies:
   - `priority_then_recency`: best trust tier, then stated over inferred, then the most recent effective date (`as_of_date` / `valid_from` / last observation)
   - `recency_then_priority`: for volatile fields such as deadlines and member counts
   - Ties break on corroborated confidence, then on claim id (deterministic).
3. **Conflicts.** A differing value is flagged as a conflict when it is within one trust tier of the winner and inside the field's staleness window. Otherwise it is treated as history rather than disagreement. Alternatives are kept and shown in the UI.
4. **Multi-valued fields** (links, categories, aliases, join modes, tags) take the union, deduplicated by normalized value.
5. **Badges:**
   - Verified: stated by tier 1–5 and fresh
   - Reported: tier 6–8, or stale
   - Community: tier 9 or user-reported
   - Computed
   - Estimate: inferred or derived
   - Unknown
6. **Links** go through candidate-and-verification (`verifyLink`, ADR 0017), ending up `verified`, `probable` or `unverified`, with confidence and signals. See [Web presence](#web-presence-discovery-and-verification).

The projection writer (`resolveClub`) stores the winner of each field in `club` columns, plus the full provenance (`ResolvedValue`: sources, quotes, observed dates, badge, alternatives) in `club.fields`, which the UI renders through `<FieldValue>` / `<Provenance>`.

## Entity resolution

`matchOrganization()` in `packages/core/src/entity/match.ts` (`matcher-v2`) compares a candidate against known clubs. Fixture clubs are excluded.

| Signal                                                                                                                       | Effect                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Same external id (e.g. `pbha:alzheimersbuddies`)                                                                             | strong ⇒ definite                               |
| **Different** id in the same system                                                                                          | candidate **ruled out**: different organization |
| Shared official site (`siteKey`: host, or host + path on shared hosts like `sites.google.com/view/x`, `pbha.org/programs/x`) | strong ⇒ definite                               |
| Shared social account (`instagram:handle`, …)                                                                                | strong ⇒ definite                               |
| Exact normalized name or alias (keeps "harvard" and "undergraduate" tokens)                                                  | definite, unless the official sites differ      |
| Acronym, initials, trigram similarity, same core name                                                                        | probable only                                   |
| A rival candidate of similar strength                                                                                        | probable                                        |

Outcomes:

- **definite:** attach to the club
- **probable:** create a new club **and** a `merge_candidate` row for human review. Nothing is ever auto-merged on weak evidence.
- **new:** create a club

A mention seen before (same `source_id` + `external_key`) keeps its club, so runs are stable. Merges are designed to be non-destructive: `club.record_state = 'merged'` plus `merged_into_club_id`, and profile lookups follow the redirect. Merge tooling itself is M3.

## Search

`PostgresSearchProvider` behind the `SearchProvider` interface:

- **Document:** `club_search_document` holds normalized names (canonical + acronym + aliases) for trigram matching, an `acronyms[]` array, and a weighted `tsvector`:
  - A: names, both `simple` and `english` configs
  - B: category names and tags
  - C: short description
  - D: long description
- **Match:** a result matches if any of these hold:
  - the FTS document matches a prefix query or `plainto_tsquery('english', q)`
  - the query is an exact acronym
  - `word_similarity(q, names) ≥ 0.45`, which handles typos
  - the query is a substring of the names
- **Rank:** acronym (10) > exact name/alias (8) > name prefix (3) > `ts_rank_cd` × 2 > word similarity × 2.
- **Filters:** category (a parent includes its children), join modes (array overlap), recognition, org type, first-year eligible (`true` only; unknown is not eligible), recruiting now (an SQL mirror of `computeCycleStatus`, covered by the integration tests), and inactive (hidden by default).
- **Indexes:** GIN on the tsvector, GIN `gin_trgm_ops` on names, GIN on `club.join_modes`.

At hundreds to a few thousand clubs this is fast without external infrastructure.

## Data freshness

- Every `ResolvedValue` carries `observedAt` (the latest evidence), an optional `asOf`, and a `stale` flag computed from the field's volatility: static 730 days, semester 180 days, volatile 30 days. Stale official values downgrade from Verified to Reported.
- Re-fetching identical content advances `claim_evidence.observed_at` (a re-observation) without creating rows.
- Recruiting-cycle status (`open` / `deadline_ahead` / `upcoming` / `closed` / `unknown`) is **computed at read time** from date claims and `now`. Date-only deadlines end at 23:59:59 America/New_York and are never shown with an invented time.
- Profiles show last observed, sources with last-seen dates, completeness, and when the profile was rebuilt.
- Not yet built: a scheduled `recheck` job driven by `source.recheck_interval_hours` (roadmap).

---

# M2: discovery and enrichment system

```
pnpm ingest:discover   →  13 adapters (official Harvard pages first, then Hillel, Wikipedia last) → candidates → entity resolution → claims
pnpm ingest:enrich     →  per club: verify website → shallow crawl → normalize pages → deterministic (+ optional LLM) extraction → claims
pnpm ingest:reconcile  →  cross-club duplicate pass (strong ids only) → full deterministic re-resolve
pnpm ingest:stats | ingest:export   →  coverage report / JSON+CSV exports (data/exports)
```

Every stage writes an `ingestion_run` with counters (organizations discovered, new clubs, duplicates, pages fetched/unchanged/fresh-skipped/failed, claims extracted and new, links discovered, LLM calls/tokens/cost, elapsed time) and an error summary. Every stage is restartable and idempotent.

## Candidates and entity resolution

Each directory row is an `entity_mention` (a candidate), never assumed to be a club. The matcher (`matcher-v2`) uses:

- **strong signals:** directory id, verified site, verified social handle;
- **medium signals:** exact normalized name or alias, including "Name (ACR)" forms; acronym plus overlapping description;
- **weak signals:** acronym/initials only, trigram similarity, same core name.

It returns `definite` / `probable` / `ambiguous` / `new` with a persisted explanation. Only `definite` attaches automatically. `probable` and `ambiguous` create a new club plus merge candidates. Merges are reversible and audited (ADR 0019). Graduate-school groups (named "GSAS …", "HKS …") get an inferred `graduate_school` affiliation and are hidden from the default directory.

Adapter keys are permanent. A mention's `(source, external_key)` pins it to its club across runs, and two different ids from the same directory mean two different organizations. Changing a key scheme therefore creates duplicates. Extra identifiers, such as Wikipedia article titles, go in their own namespace.

## Web presence discovery and verification

Links come only from pages we fetched: directory listings and the club's own pages. There is no search-engine guessing and no social scraping. See ADR 0017 for the verified / probable / unverified rules. Directory pages _about_ an org are `harvard_directory` links, not identity-bearing sites.

## Shallow crawler (`packages/pipeline/src/crawl/site.ts`)

- **Scope:** starts at the verified or probable site root and stays inside the site boundary (`sameSite`, which understands shared hosts such as `sites.google.com/view/<x>`).
- **Prioritization:** pages are ranked by role, classified from URL and anchor text: recruiting > join > about > faq > projects/sponsors > events > team > contact.
- **Limits:** `--max-pages` (default 6) and `--max-depth` (default 1). "Other" pages are not followed beyond depth 1.
- **Skipped:** binaries and assets.
- **Deduplication and freshness:** identical content under two URLs is processed once. Pages fetched within the freshness window (`--freshness-hours`, default 168) are reused, not refetched; otherwise the crawler sends conditional GETs. `--force` refetches everything.
- **Fetching:** goes through the polite fetcher (robots.txt, per-host spacing, retries, size and time limits). Every attempt is logged in `fetch_attempt`.
- **JS-rendered pages:** empty app shells are flagged `source.needs_browser`. Only their server-rendered links are used; there is no Playwright yet, by design.
- **Source types:** pages of a verified site are `club_website` (tier 2, owned by the club); pages of a probable site are `public_web` (tier 8).

## Text normalization (`parse/document.ts`)

HTML becomes a `PageDocument`:

- title, h1, meta and OG descriptions, JSON-LD;
- blocks (heading/paragraph/list item/table cell/quote), each with an index and its section heading;
- links with absolute URLs and a nav/footer flag;
- a markdown-ish text rendering, which is what `source_snapshot.extracted_text` stores.

Scripts, styles, forms, cookie/consent banners, hidden elements and nav/header/footer chrome are removed from the text, and repeated boilerplate blocks are deduplicated. Claims carry `locator = {url, role, block, section}` and a verbatim quote.

## Extraction

**Deterministic** (`extract/deterministic.ts`, conservative by design):

- **links:** the club's own socials, role emails only, application pages and forms, mailing lists; institutional accounts, personal profiles and personal emails are dropped;
- **descriptions and mission:** prose about the club only; personal bios and nav dumps are rejected;
- **join modes;**
- **recruiting dates:** relative dates resolve only against the snapshot fetch date; parse confidence and original text are kept; stale recruiting text is ignored;
- **process types and application URL;**
- **hours per week, member counts, dues, eligibility / class years;**
- **selectivity:** numbers only when a term is explicit in the same sentence; the club's qualitative language ("highly competitive") is kept verbatim as `club.self_described_selectivity`, never converted to a number;
- **sponsors:** from sponsors pages only.

Team pages contribute only links and aggregate size.

**LLM** (optional, ADR 0018): grounded structured extraction behind a provider interface, with a cache, budget and dry run.

## Time and semester parsing (`@hci/core` `timeparse.ts`)

- **Handled forms:** "Fall 2026", "Spring '27", "this fall", "next semester", "applications close September 18", "apply by 11:59 PM ET Friday", ISO dates and US numeric dates.
- **Reference dates:** relative forms need an explicit reference date (the fetch date) and are otherwise left unresolved.
- **Output:** `{at, precision, originalText, confidence, notes}`, with Eastern-time offsets that account for DST.
- **Vague phrases** ("comp starts next week") are recognized and deliberately not converted.

## Activity (ADR 0020) and recruiting

Activity is a derived estimate with confidence and reasons. `getRecruitingBoard` groups cycles that have a sourced date or stated status into open/deadline-ahead, upcoming, and recently closed (30 days). It can be filtered by category, process type, class year and deadline window. Each cycle carries `last_verified_at`.

## Review and export

- `/admin/review` (exists only under `pnpm dev`; not part of the static export, ADR 0022) and `pnpm hci review|merge|unmerge|reject`.
- `pnpm hci export` writes public data only: `clubs.json`, `clubs.csv`, `links.csv`, `claims.csv`, `merge-candidates.csv`.
