# Architecture

How data moves from the public web to a club profile. CLAUDE.md is the specification; this document describes what is **implemented** (M1) and where it lives.

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
6. **Links** are `verified` (official) only when stated by a tier ≤ 5 source. Otherwise they are `candidate` ("Unconfirmed").

The projection writer (`resolveClub`) stores the winner of each field in `club` columns, plus the full provenance (`ResolvedValue`: sources, quotes, observed dates, badge, alternatives) in `club.fields`, which the UI renders through `<FieldValue>` / `<Provenance>`.

## Entity resolution

`matchOrganization()` in `packages/core/src/entity/match.ts` (`matcher-v1`) compares a candidate against known clubs. Fixture clubs are excluded.

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
