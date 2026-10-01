# Data model

Schema source of truth: `packages/db/src/schema/index.ts`. Migrations are in `packages/db/migrations/` and are committed; never edit one that has been applied. Field vocabulary: `packages/core/src/fields/registry.ts`.

## Layers

| Layer       | Tables                                                                                                                                                                                              | Written by                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Evidence    | `ingestion_run`, `source`, `source_snapshot`, `fetch_attempt`                                                                                                                                       | pipeline                                           |
| Assertions  | `claim`, `claim_evidence`, `entity_mention`, `merge_candidate`, `editorial_decision`, `student_submission`                                                                                          | pipeline / seed / (future) editors and submissions |
| Identity    | `club` (identity columns), `club_slug_history`, `recruiting_cycle` (identity columns), `category`                                                                                                   | pipeline / seed                                    |
| Projections | `club` (display columns + `fields`), `club_alias`, `club_link`, `club_category`, `membership_estimate`, `recruiting_cycle` (display columns + `fields`), `recruiting_stage`, `club_search_document` | **resolver only**                                  |

Projections can be dropped and rebuilt with `pnpm hci resolve`.

## Tables

### `club`

Identity: `id` (UUIDv7), `slug` (unique, format-checked), `canonical_name`, `record_state` (`active` | `merged` | `hidden`), `merged_into_club_id` (a check keeps it consistent with `merged`), `data_origin` (`ingested` | `fixture` | `editorial`).

Projection columns: `acronym`, `short_description`, `long_description`, `org_type`, `recognition_status`, `activity_status`, `affiliation_scope`, `join_modes[]`, `freshmen_eligible`, `hours_per_week_min/max`, `member_count_min/max`, `fields` (JSONB: `Record<fieldKey, StoredField>` with full provenance), `completeness`, `source_count`, `conflict_fields[]`, `last_observed_at`, `resolved_at`, `resolver_version`.

### `source`

A logical document. `normalized_url` is unique; `domain`; `source_type` (text, validated by Zod); `trust_tier` (0–9, checked); `publisher`; `owner_club_id` (set when established as a club channel); `adapter`; `is_fixture`; `recheck_interval_hours`; `last_fetched_at`.

### `source_snapshot` (immutable)

`source_id`, `ingestion_run_id`, `fetched_at`, `final_url`, `http_status`, `content_type`, `etag`, `last_modified`, `content_sha256`, `byte_size`, `storage_key` (the raw bytes live in the SnapshotStore), `extracted_text`, `fetch_method`. Unique `(source_id, content_sha256)`.

### `fetch_attempt`

Every fetch attempt: `status` enum (`ok`, `not_modified`, `http_error`, `network_error`, `robots_disallowed`, `skipped`), plus HTTP status, error, attempts, duration and the resulting snapshot.

### `ingestion_run`

`job`, `adapter`, `adapter_version`, `status` enum, `started_at`/`finished_at`, `options`, `counters` (JSONB), `error_summary`, `git_sha`.

### `claim`

`subject_type` (`club` | `recruiting_cycle`, with a check keeping it consistent with `recruiting_cycle_id`), `club_id` (always set), `recruiting_cycle_id`, `field_key`, `value`, `normalized_value`, `value_hash`, `assertion_kind` enum, `status` enum, `term_key`, `valid_from`/`valid_until` (checked order), `as_of_date`, `first_observed_at`/`last_observed_at`.

Identity: **unique NULLS NOT DISTINCT** `(subject_type, club_id, recruiting_cycle_id, field_key, value_hash, term_key, assertion_kind)`, which makes re-ingestion idempotent.

### `claim_evidence`

`claim_id`, `source_id`, `snapshot_id` | `submission_id`, `ingestion_run_id`, `observed_at`, `evidence_quote`, `evidence_locator`, `extraction_method`, `extractor_name`/`extractor_version`, `llm_model`/`prompt_version`, `confidence` (0–1, checked), `is_direct`.

Checks:

- evidence needs an origin: a snapshot, a submission, or a `manual` / `fixture` method
- LLM evidence requires a model, a prompt version and a quote

Unique NULLS NOT DISTINCT `(claim_id, source_id, snapshot_id, extractor_name, extractor_version)`.

### `entity_mention` and `merge_candidate`

- A mention is an organization as referenced by a source: `source_id` + `external_key` (unique), `raw_name`, `payload` (external ids, URLs), `resolution` enum, `resolved_club_id`, `match_score`, `match_signals`, `matcher_version`.
- A merge candidate is a proposed pair (`club_a_id < club_b_id`, checked; unique pair) with score, signals, and a status of `proposed` / `confirmed` / `rejected`.

### `recruiting_cycle` and `recruiting_stage`

- A cycle is an identity row per `(club_id, term_key, track)` (unique; `term_key` format-checked, e.g. `2026-fall`). Its attributes are claims with `subject_type = recruiting_cycle`. The projection columns are `opens_at`/`deadline_at` (instants for querying), `opens_value`/`deadline_value` (the original `DateValue` for faithful display), `process_types[]`, `stated_status`, `application_url`, `applicants`, `admits` and `fields`.
- Cycle **status is not stored**; it is computed at read time.
- `recruiting_stage` is projected from the `cycle.stages` claim.

### `membership_estimate`

One row per eligible `club.member_count` claim (exact or range, shape-checked), with `as_of`, `term_key`, `badge`, and `is_current` for the resolver's winner. This preserves history such as "40–60 (2025)" and "55 (2026)".

### `category` and `club_category`

A hierarchical editorial taxonomy (`parent_id`), seeded idempotently by slug and safe for production. `club_category` is projected from `club.category` claims; `is_primary` is set on the first one.

### `club_link`

`kind`, `url`, `normalized_url` (unique per club), `handle`, `label`, `status` (`verified` | `probable` | `unverified` | `rejected`, checked), `confidence`, `discovered_via[]` (source types, best first), `signals[]` (why it has that status), `claim_id`, `last_observed_at`. See ADR 0017.

### `club_search_document`

`names` (normalized, `|`-joined), `acronyms[]`, and a weighted `document` tsvector. Indexes: GIN on the tsvector, GIN trigram on `names`, GIN on `acronyms`.

### `student_submission`, `submission_proposal`, `comp_report` (ADR 0035)

**`student_submission`** is one form response.

- **Columns:** `kind` (contribution type), `club_id` (null until matched), `payload`, `evidence_url`, `submitter_ref` (always null for form imports), `status`, `review_note`, `reviewed_at`, `resulting_claim_ids[]`.
- **Payload:** the raw non-personal answers, the submission time, the club text, the form answer and the message, with contact details stripped. It may also carry `duplicateOf`.
- **Status:** `pending` | `accepted` | `partially_accepted` | `rejected` | `spam`. It follows the submission's proposals and is never edited by hand.

**`submission_proposal`** is one proposed field value from a submission.

- **Columns:** `position` (unique within the submission), `field_key` (registry key or `duplicate_of`), `label`, `raw_text`, `value` (null when it couldn't be parsed), `term_key`, `parse_note`, `origin` (`form` | `editor`).
- **Decision:** `status` (`pending` | `accepted` | `rejected`), `decision_reason`, `decided_by` and `decided_at` (set exactly when the status isn't pending), `resulting_claim_ids[]`, `evidence_check`.
- **What accepting writes:** a tier-9 `user_reported` claim evidenced by the submission. When the evidence URL's fetched page states the value, it also writes a `stated` claim from that snapshot.

**`comp_report`** is an anonymous comp outcome.

- **Columns:** club, optional cycle, `term_key`, `track`, coarse `class_year`, `applied`, `furthest_stage`, `accepted`, approximate applicants/cohort, `hours_spent`, `notes` (moderation only), `status`, `reported_on` (a date).
- **No identity:** there is no user or submitter column.
- **Checks:** valid class years; an outcome only if the reporter applied; positive counts.
- **Display:** nothing is shown yet. Aggregation rules are in `@hci/core/comp-reports.ts`.

### `editorial_decision`

An audited log of human actions (pin or reject a claim, confirm a merge, hide a club, …). Schema only for now.

## Enum policy

Postgres enums are used only for closed lifecycle states (record state, data origin, assertion kind, claim status, subject type, run status, fetch status, mention resolution, merge-candidate status, submission status). Open vocabularies are `text` validated by Zod in `@hci/core`, so extending them doesn't require a migration: source types, link kinds, org types, recognition and activity statuses, join modes, stage kinds, categories.

## Value shapes (`packages/core/src/fields/values.ts`)

- `MembershipEstimate`: `{kind: "exact", count}` or `{kind: "range", min, max}`, where at least one bound is required and min ≤ max
- `HoursPerWeek`: `{min, max, qualifier?: "comp_period" | "member"}`
- `DateValue`: `{at, precision: "date" | "datetime", label?}`. Date-only values stay date-only.
- `StageValue`: `{order, kind, label?, startsAt?, endsAt?}`
- `LinkValue`: `{kind, url, handle?, label?}`
- `AliasValue`
- `DuesValue`

## Adding a field

1. Add a registry entry in `packages/core/src/fields/registry.ts`: schema, cardinality, temporality, volatility, resolution strategy, and `allowInferred`.
2. If it should be filterable or sortable, add a projection column in `resolveClub()` and a migration (`pnpm db:generate`).
3. Render it through `<FieldValue>` in the UI.
4. Add tests.

## M2 additions (migration `0002_enrichment`)

- **`club`:**
  - `eligible_classes[]`;
  - `activity_confidence` and `activity_reasons[]` (the derived activity assessment, ADR 0020);
  - `last_verified_at` (the latest observation by a tier ≤ 2 source).
- **`recruiting_cycle`:** `eligible_classes[]` and `last_verified_at`.
- **`source`:**
  - `page_role` (home / about / join / recruiting / faq / team / events / projects / sponsors / contact / other, for crawled pages);
  - `needs_browser` (the page looked like an empty JS app shell).
- **`entity_mention`:** a `match_explanation` column, plus a new `ambiguous` resolution.
- **`merge_candidate`:** `reason` (`likely_duplicate` | `ambiguous` | `auto_strong_identifier`), `explanation`, and a new status `undone`.
- **`extraction_cache`:** LLM results keyed by (input text hash, extractor, prompt version, provider, model), with status, validated output, error, input/output tokens, cost and attempts. This is also the cost ledger (ADR 0018).

New registry fields:

- `club.mission`, `club.activity` (multi), `club.sponsor` (multi);
- `club.eligible_classes`, `club.self_described_selectivity`;
- `cycle.eligible_classes`, `cycle.interviewees`, `cycle.offers`, `cycle.stated_acceptance_rate`.

`DateValue` gains optional `sourceText` and `parseConfidence`, which are excluded from the value hash.

Free-text fields (names, descriptions, mission, notes) set `flagsConflicts = false`: differently worded versions are kept as alternatives but are not flagged as factual conflicts.
