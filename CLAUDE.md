# CLAUDE.md — hclubs

> Persistent engineering + product specification. **Read this file fully before doing any work in this repo.**
> If the code and this document disagree, stop and reconcile: either the code is wrong, or this document is stale and must be updated in the same change.

Status: **M2 complete** (discovery + enrichment system: 13 source adapters, candidate/entity resolution with reversible merges, link verification, shallow crawler, deterministic + optional LLM extraction, recruiting board, dev review UI). **M3 in progress** (website finder, web discovery of unlisted clubs, curated list, LLM on directory pages, browser fallback); see §22. Implementation docs: `docs/architecture.md`, `docs/data-model.md`, `docs/deployment.md`, `docs/sources/`, `docs/decisions/`.

Public name: **hclubs**, served at **https://hclubs.app/** (GitHub Pages custom domain on the public `michaellhan/hci` repo). The owner renamed it from "Harvard Club Index" on 2026-09-30 (ADR 0021, second amendment); the brand contains no Harvard mark. Internal package names (`@hci/*`, `pnpm hci`) are unchanged.

---

## Table of contents

1. Product vision
2. Core principles (non-negotiable)
3. Scope & organization taxonomy
4. Conceptual club data model
5. Data architecture (claims/evidence)
6. Field registry
7. Source priority, confidence & resolution
8. Temporal model (terms & recruiting cycles)
9. Competitiveness
10. Discovery strategy
11. Ingestion pipeline
12. Entity resolution
13. Search & filtering
14. Community contributions & comp outcome reports
15. UI requirements
16. Design direction
17. Data freshness
18. Technology stack
19. Repository layout
20. Engineering standards
21. Legal, ethical & privacy constraints
22. Roadmap & milestones
23. Agent behavior rules
24. Decision log
25. Glossary

---

## 1. Product vision

The definitive index of Harvard student organizations — "QViewer for Harvard clubs." A fast, dense, evidence-backed tool that helps Harvard students **discover, evaluate, compare, and join** student organizations.

**The problem:** club information is fragmented across Harvard directories, club websites, Instagram, LinkedIn, Linktree, recruiting decks, newsletters, Google Forms, Harvard Crimson articles, and word of mouth. It is often stale, contradictory, or missing. We aggregate it into a structured, searchable database where every fact shows where it came from and how fresh it is.

Users must be able to:

- Browse essentially every Harvard student organization we can discover.
- Search by name, acronym, aliases, keywords, description.
- Filter by meaningful attributes (category, selectivity, process type, recruiting now, freshman eligibility, time commitment, size, …).
- Open a rich profile per club: what it does, official links, how to join, whether there is a comp/application/audition/tryout, how competitive the process appears (only when evidenced), current deadlines, time commitment, size, eligibility.
- Compare clubs side by side.
- Distinguish **verified facts** vs **estimates/derived values** vs **unknown**.
- See sources and last-updated/observed dates for every dynamic field.
- Submit corrections or new information.
- Eventually contribute anonymous comp/application outcomes.

Target feel: modern, fast, dense, useful, built by and for Harvard students — not a generic org directory, not an enterprise dashboard.

**Non-goals (for now):** event calendars, messaging, club management/CRM, ranking clubs by "prestige," social feeds, native apps.

---

## 2. Core principles (non-negotiable)

### 2.1 Evidence first
Every nontrivial externally-discovered fact preserves provenance: source URL, source type, source title, fetch time, applicable time period, extraction method, confidence, and whether it was **stated** or **inferred**. An LLM inference is **never** silently turned into a fact.

### 2.2 Missing means unknown
Never fabricate: applicant counts, acceptance rates, membership counts, deadlines, time commitments, dues, eligibility, comp stages, meeting frequency — or anything else. Insufficient evidence ⇒ `null` in data, **"Unknown"** in UI. A blank/unknown field is a correct output; a plausible guess is a bug.

### 2.3 Raw data is immutable
Raw fetched snapshots are stored separately from normalized data and are never overwritten or edited. Re-fetches create new snapshots (deduplicated by content hash). Normalized data can always be rebuilt from snapshots + recorded decisions.

### 2.4 Facts, computed values, and derived classifications are different
- `applicants = 120` → **stated fact** (claim with evidence)
- `admits = 20` → **stated fact**
- `acceptanceRate = 16.7%` → **computed** (deterministic function of claims; records its inputs)
- `selectivity = "highly selective"` → **derived classification** (versioned rule over computed/stated values)

These are separate record kinds in the schema and are labeled differently in the UI.

### 2.5 Temporal data matters
Club information changes by semester. A Fall 2026 comp deadline is a property of the **Fall 2026 recruiting cycle**, not of the club. Any field that can change over time carries a temporal scope.

### 2.6 Conflicts are preserved, not deleted
If Source A says 35 members (2025) and Source B says 50 (2026), both claims exist. A deterministic resolver picks the displayed value and records why. Nothing is deleted to "fix" a conflict.

### 2.7 Deterministic and rebuildable
Given the same snapshots, extractor versions, and editorial decisions, the pipeline produces the same output. Every transformation is versioned.

---

## 3. Scope & organization taxonomy

**Initial focus:** Harvard College undergraduate organizations. The model must also represent graduate-school, Harvard-wide, cross-school, and unrecognized groups without schema changes.

**Do not assume anything is officially recognized.** Each organization has independent, evidence-backed attributes:

| Attribute | Values (initial; extend via registry) |
|---|---|
| `recognitionStatus` | `recognized`, `not_recognized`, `formerly_recognized`, `unknown` — plus `recognizingBody` (free text/enum, e.g. College student org office, Recreation/club sports, a graduate school) |
| `activityStatus` | `active`, `likely_active`, `possibly_dormant`, `inactive`, `defunct`, `unknown` (with `lastActivityObservedAt`) |
| `affiliationScope` | `harvard_college`, `graduate_school` (+ which school), `university_wide`, `cross_school`, `harvard_chapter_of_external_org`, `independent`, `unknown` |
| `orgType` (structural, one primary) | `student_organization`, `club_sport`, `publication`, `performing_arts_group`, `competition_team`, `social_organization`, `public_service_program`, `governance_body`, `academic_society`, `other` |
| Categories (topical, many) | e.g. Pre-professional › Finance/Consulting/Tech/Law/Medicine; Cultural & Identity; Performing Arts › A cappella/Dance/Theater/Music; Publications; Public Service; Political & Advocacy; Religious & Spiritual; Academic & STEM; Athletics & Recreation; Social; Entrepreneurship; Gaming & Hobbies |

Includes: officially recognized College orgs, unrecognized groups, Harvard-wide orgs, club sports, publications, performing arts, cultural orgs, pre-professional orgs, public service, competition teams, social organizations, final clubs / invitation-based orgs **where public information exists**, and inactive/dormant orgs (kept, labeled, and hidden from default browse only when confidently inactive).

Pitfall: "Harvard X Society" (graduate/HBS) and "Harvard Undergraduate X Society" may be **different organizations**. Affiliation scope must be evidenced, never inferred from the name alone.

---

## 4. Conceptual club data model

These are the **conceptual fields** the product supports. Physically, almost all of them are **claims** (§5) keyed by a field registry entry (§6), projected into a read model for display. Fields marked ⏱ are temporal (time-varying or cycle-scoped).

**Identity:** canonical name, slug, acronym, alternate names, former names, aliases, logo, cover image.

**Description:** short description (≤ ~160 chars, our own summary), long description, mission, activities, tags, categories, subcategories.

**Status:** recognition status ⏱, recognizing body, activity status ⏱, org type, affiliation scope.

**Links** (each link is its own claim with a `linkKind` and an `officialness` level): official website, Instagram, LinkedIn, Facebook, X/Twitter, YouTube, TikTok, Linktree/link-in-bio, Discord/Slack invite (only if publicly posted), mailing list, newsletter signup, application page ⏱, application form ⏱, Harvard official directory page, generic contact email (club role addresses only — never personal emails), other.

**Membership:** member count ⏱ (exact or range — `MembershipEstimate`), eligibility ⏱, freshmen allowed ⏱, graduate students allowed, cross-registration / MIT / other-school eligibility, dues ⏱, meeting frequency ⏱, expected hours/week ⏱ (range), required attendance, prior-experience requirements.

**Joining process** (`joinMode`, may be multi-valued): `open`, `application`, `comp`, `audition`, `tryout`, `invite_only`, `attendance_based`, `unknown`.

**Recruiting cycle** (per cycle ⏱ — see §8): term, audience (e.g. first-years only), opening date, deadline(s), stages (written application, coffee chats, interviews, case interview, technical interview, audition, tryout, final round, other), comp duration, applicants, interviewees, offers, accepted members, computed acceptance rate, derived selectivity, links to application materials.

**Activities:** projects, publications, performances, conferences, competitions, social events, service work, client work, training/education, notable recurring events.

**External relationships:** sponsors, partner organizations, companies, publicly disclosed clients.

**Metadata (computed, never claimed):** last verified, last source fetch, per-field confidence, completeness score, source count, conflict count.

**Explicitly out of scope for v1:** individual member rosters, officer names/contacts, personal emails/phones. (Privacy + staleness; revisit only with a clear use case and ADR.)

---

## 5. Data architecture (claims/evidence)

### 5.1 Layering

```
Source ──< SourceSnapshot (immutable, blob in object storage)
                 │
                 ├──< EntityMention (unresolved org references found in a snapshot)
                 │
                 └──< ClaimEvidence >── Claim (subject, field, value, temporal scope)
                                          │
                               Resolver (deterministic, versioned)
                                          │
              ComputedValue / DerivedClassification (inputs recorded)
                                          │
                  Projections: club_profile, club_link, club_alias, club_category,
                  recruiting_cycle_view, club_search_document   ← UI reads ONLY these
```

**Golden rule:** ingestion writes **sources, snapshots, mentions, claims, evidence**. It never writes projection tables directly. Projections are rebuilt by the resolver from claims + editorial decisions and can be dropped and regenerated at any time.

### 5.2 Core tables (target schema — refine during implementation, record changes in §24)

All IDs are UUIDv7 (time-sortable) unless noted. All timestamps are `timestamptz` UTC. Enums are Postgres enums or check-constrained text mirrored by Zod enums in `packages/core`.

**Identity**
- `club` — identity: `id`, `slug` (unique), `canonical_name`, `record_state` (`active` | `merged` | `hidden`), `data_origin` (`ingested` | `fixture` | `editorial`), `merged_into_club_id` (check: set iff merged), timestamps. **As implemented (ADR 0014)** `club` also carries the resolver-written projection columns (`acronym`, descriptions, statuses, `join_modes`, `freshmen_eligible`, hours/member ranges, `fields` JSONB provenance, completeness, …) instead of a separate `club_profile` table. Canonical name/slug are chosen by resolver or editor; history via claims + `club_slug_history` (old slugs redirect).
- `club_slug_history` — `slug` (unique), `club_id`, `retired_at`.

**Sources & snapshots**
- `source` — a logical document/endpoint: `id`, `url` (normalized), `url_hash` (unique), `domain`, `source_type` (enum, §7.1), `trust_tier` (1–9, §7.1), `owner_club_id` (nullable; set when the source is established as a club's own channel), `title`, `discovered_via` (adapter + run), `recheck_policy`, `robots_allowed` (last check), `active`.
- `source_snapshot` — immutable: `id`, `source_id`, `fetched_at`, `final_url`, `http_status`, `content_type`, `content_sha256`, `byte_size`, `storage_key` (object storage path), `text_sha256` (of extracted text), `fetch_method` (`static` | `browser` | `api` | `manual_upload` | `user_submitted`), `ingestion_run_id`. Unique `(source_id, content_sha256)` — an identical re-fetch does **not** create a new snapshot; it updates `fetch_attempt`.
- `fetch_attempt` — every fetch try: `source_id`, `run_id`, `started_at`, `status`, `error_class`, `retry_count`, `http_status`, `etag`, `last_modified`, `snapshot_id` (nullable).
- `ingestion_run` — `id`, `job` (e.g. `discover:<adapter>`, `fetch`, `extract:<extractor>`, `resolve`), `started_at`, `finished_at`, `status` (`running` | `succeeded` | `partial` | `failed`), `git_sha`, `config` jsonb, `stats` jsonb, `error_summary`.

**Mentions & resolution**
- `entity_mention` — an org referenced in a snapshot before it is tied to a club: `snapshot_id`, `raw_name`, `raw_acronym`, `urls[]`, `handles` jsonb, `external_ids` jsonb (e.g. directory id), `context` jsonb, `resolved_club_id` (nullable), `resolution` (`auto_strong_id` | `auto_high_score` | `manual` | `new_club` | `pending`), `resolver_version`.
- `club_merge_candidate` — `club_a_id`, `club_b_id`, `score`, `signals` jsonb, `status` (`proposed` | `confirmed_merge` | `rejected` | `split`), `decided_by`, `decided_at`.

**Claims**
- `claim` — one assertion of a value for a field about a subject within a temporal scope:
  - `id`, `subject_type` (`club` | `recruiting_cycle`), `subject_id`, `field_key` (FK → field registry key, validated in code)
  - `value` jsonb (as stated, validated by the field's Zod schema), `normalized_value` jsonb, `value_hash`
  - `assertion_kind`: `stated` | `inferred` | `user_reported` | `editorial`
  - temporal scope: `valid_from`, `valid_until` (nullable), `term_key` (nullable, e.g. `2026-fall`), `as_of_date` (the date the source says the value applied, if stated)
  - `status`: `active` | `superseded` | `retracted` | `rejected`, `status_reason`
  - `first_observed_at`, `last_observed_at`, `created_at`
  - Unique `(subject_type, subject_id, field_key, value_hash, coalesce(term_key,''), assertion_kind, origin_source_id)` → idempotent re-ingestion.
- `claim_evidence` — each observation supporting a claim: `claim_id`, `source_id`, `snapshot_id` (nullable only for editorial/user submissions, which reference `student_submission` or `editorial_decision` instead), `observed_at`, `evidence_quote` (verbatim span, required for `stated` claims from text), `evidence_locator` jsonb (CSS selector / char offsets / JSON path / page number), `extraction_method` (`structured_data` | `html_parse` | `llm` | `manual` | `user_submission`), `extractor_name`, `extractor_version`, `llm_model` + `prompt_version` (when `llm`), `confidence` (0–1, §7.2), `is_direct` (bool: directly stated vs. inferred). Unique `(claim_id, snapshot_id, extractor_name, extractor_version)`.

Conflicting values ⇒ distinct claims. Same value from two sources ⇒ one claim, two evidence rows.

**Computed & derived**
- `computed_value` — deterministic calculations: `subject`, `field_key` (e.g. `cycle.acceptance_rate`), `value`, `algorithm`, `algorithm_version`, `input_claim_ids[]`, `computed_at`.
- `derived_classification` — rule-based labels: `subject`, `field_key` (e.g. `cycle.selectivity_label`), `label`, `rule_set_version`, `input_refs` jsonb, `computed_at`. UI always labels these as derived.

**Editorial**
- `editorial_decision` — audited human actions: pin/reject claim, confirm merge/split, set canonical name, override officialness, hide club. `actor_id`, `action`, `target`, `reason`, `created_at`. Editorial overrides enter the resolver as highest-precedence inputs and are themselves reversible.

**Projections (read model, rebuildable)**
- `club_profile` — one row per displayable club: resolved scalar fields + per-field `{claim_id, observed_at, confidence, badge}` metadata in jsonb, `completeness`, `source_count`, `last_observed_at`, `conflict_fields[]`, `resolver_version`.
- `club_alias`, `club_link`, `club_category`, `recruiting_cycle_view`, `club_search_document` (§13).

**Recruiting**
- `recruiting_cycle` — identity row: `id`, `club_id`, `term_key`, `track` (default `main`; e.g. `first_year`, `general`, `analyst`), unique `(club_id, term_key, track)`. All attributes (dates, stages, counts) are claims with `subject_type = recruiting_cycle`.

**Taxonomy**
- `category` (hierarchical: `id`, `slug`, `name`, `parent_id`), assigned via claims (`club.categories`) resolved into `club_category`. `tag` is free-form normalized strings via claims.

**Community (schema designed now, built later — §14)**
- `app_user`, `club_manager_role`, `student_submission`, `comp_report`, `staleness_vote`.

### 5.3 `MembershipEstimate` and other structured values
Not separate tables. They are Zod-validated **value shapes** used by claims, e.g.:

```ts
MembershipEstimate = { kind: "exact", count: number } | { kind: "range", min: number | null, max: number | null }
  // plus claim-level as_of_date / term_key
HoursPerWeek = { min: number | null, max: number | null, qualifier?: "comp_period" | "member" }
Deadline = { at: string /* ISO, America/New_York */, precision: "datetime" | "date", label?: string }
Stage = { order: number, kind: StageKind, label?: string, startsAt?: Deadline, endsAt?: Deadline }
```

Add a dedicated table only if query patterns demand it (record an ADR).

---

## 6. Field registry

`packages/core/src/fields/` holds a typed registry — the single source of truth for every claimable field. **Add a registry entry before any code writes claims for a new field.**

Each entry defines:
- `key` (e.g. `club.member_count`, `cycle.deadline`, `club.link`)
- `subjectType` (`club` | `recruiting_cycle`)
- `valueSchema` (Zod) and `normalize(value)` (pure)
- `cardinality`: `single` (one displayed value) | `multi` (set, e.g. aliases, links, categories)
- `temporality`: `stable` | `time_varying` | `cycle_scoped`
- `volatility` → default recheck cadence and staleness threshold (§17)
- `resolution`: `priority_then_recency` | `recency_then_priority` | `union` | `editorial_only`
- `sensitivity`: `public` | `aggregate_only` | `internal` (e.g. comp report fields)
- `allowInferred`: whether an inferred claim may ever be displayed (default **false** for numbers, dates, money, eligibility)
- `display`: label, formatter, unknown text

The registry drives: DB validation in code, extractor output schemas, resolver behavior, UI rendering, filters, and the methodology page.

---

## 7. Source priority, confidence & resolution

### 7.1 Source types and default trust tiers

| Tier | `source_type` | Examples |
|---|---|---|
| 1 | `harvard_official` | Harvard/College org directories, Dean of Students pages, Harvard Recreation club sports, SEAS/department lists, PBHA, IOP |
| 2 | `club_website` | Club's own domain |
| 3 | `club_social` | Club's verified Instagram/LinkedIn/Facebook/X/YouTube/TikTok/Linktree |
| 4 | `club_recruiting_material` | Club application page/form, recruiting deck |
| 5 | `club_publication` | Club newsletter, public docs |
| 6 | `harvard_crimson` | The Harvard Crimson |
| 7 | `harvard_related_other` | Other Harvard-affiliated publications/sites |
| 8 | `public_web` | Other public web sources |
| 9 | `student_submission` | Anonymous/student-submitted info |

A source becomes tier 2–5 ("official club channel") only when its ownership is established: linked from a tier-1 source or from an already-established club channel, or confirmed editorially. A social account merely *named like* the club is `public_web` until established.

Lower tiers are **not** treated as false. Context-specific exceptions are expressed via the registry's `resolution` strategy — e.g. for `cycle.deadline` a fresh club Instagram post (tier 3) beats a year-old Harvard directory entry (tier 1).

### 7.2 Confidence rubric (0–1)
`confidence = base(tier) × method_factor × directness_factor`, clamped, computed by a versioned function — not hand-assigned per claim. Starting values (tune later, record changes):
- base: tier 1 = 0.95 … tier 8 = 0.5, tier 9 = 0.35
- method: `structured_data` 1.0, `html_parse` 0.95, `manual` 0.95, `llm` with verified verbatim quote 0.85, `llm` without quote → **not allowed for stated claims**
- directness: `is_direct` 1.0, inferred 0.5
Corroboration by independent sources may raise displayed confidence (resolver-level, capped).

### 7.3 Resolver
Deterministic, versioned (`resolver_version`), pure function over `(active claims, evidence, editorial decisions, now)`:
1. Filter to `active` claims for the field/subject; apply temporal scope (current term for cycle fields; `valid_until` not passed).
2. Editorial pins win; editorial rejections exclude.
3. Apply the field's resolution strategy (priority/recency with tier and `last_observed_at`), tie-break by confidence, then by claim id (stable). For recency-first fields an undated claim's observation time counts only per staleness window (resolver-v2, ADR 0033): a re-crawled lower-tier page never outranks a fresh official one just by being fetched later.
4. Emit display value + chosen claim + `badge` + `conflict: true` if a competing claim of comparable tier/recency disagrees.
5. `multi` fields: union of sufficiently-established claims, deduped by normalized value.

### 7.4 Display badges (single vocabulary everywhere)

> **Owner decision (ADR 0028):** the public UI no longer shows these badges, freshness text or source popovers on values. Facts display plainly, and each profile has one collapsed "Sources" section. The vocabulary below is kept for the data model, the methodology page and internal tools.

- **Verified** — stated, tier 1–5, within freshness window.
- **Reported** — stated by tier 6–8, or tier 1–5 but stale.
- **Community** — tier 9 / user-reported (aggregated where applicable).
- **Computed** — deterministic calculation from claims (shows inputs on hover).
- **Estimate** — derived classification or inferred value (only where `allowInferred`).
- **Conflicting** — resolver found disagreement; show alternatives on expand.
- **Unknown** — no acceptable evidence.

---

## 8. Temporal model (terms & recruiting cycles)

- `term_key` format: `YYYY-season`, season ∈ `spring | summer | fall | winter` (e.g. `2026-fall`). Academic year helper: `AY2026-27` = `2026-fall` + `2027-spring`. Rolling recruitment is `track = rolling` with explicit date claims.
- Dates are stored as UTC `timestamptz`; deadlines additionally keep `precision` and are displayed in `America/New_York`. A date-only deadline is **not** silently converted to 11:59 PM.
- A recruiting cycle's status (`upcoming` | `open` | `closed` | `unknown`) is **computed** at read time from date claims + `now`, never stored as a claim unless a source explicitly states "applications are closed."
- Stable-over-time club fields (name, mission) still carry `first_observed_at`/`last_observed_at`.
- "Recruits in fall/spring" (pattern) is a club-level claim, distinct from specific cycle instances.

---

## 9. Competitiveness

Highest-risk field. Rules:

- **Never invent an acceptance rate.** Never estimate one from vibes, prestige, or LLM priors.
- Quantitative evidence only from: club-published applicant/admit numbers, recruiting presentations, articles, cycle reports, or aggregated student reports (§14, with sample-size thresholds).
- Structured fields per cycle: `applicants`, `interviewees`, `offers`, `accepted`, `acceptanceRate` (computed; exact or range), `estimateRange`, `sampleSize` (for community data), `confidence`.
- A club *saying* "our process is very competitive" is stored as a stated qualitative claim (`cycle.self_described_selectivity`) and displayed as *"Club describes its process as…"* — **not** as a selectivity label.
- `selectivityLabel` (e.g. `open`, `moderately_selective`, `selective`, `highly_selective`) is a `derived_classification` computed by a versioned rule set with explicit thresholds and minimum-evidence requirements. It is always shown with the **Computed/Estimate** badge and a link to its inputs.
- **Process type ≠ selectivity.** "Has a comp" says nothing about acceptance rate; some comps admit everyone who completes them. Keep `joinMode` and selectivity independent.
- Insufficient evidence ⇒ **"Unknown."**

---

## 10. Discovery strategy

Discovery = finding organizations and candidate sources. Implemented as **adapters** with a common interface (`packages/pipeline/src/adapters/<name>/`):

```ts
interface DiscoveryAdapter {
  name: string; version: string;
  sourceType: SourceType;
  seeds(): AsyncIterable<SeedUrl>;
  parse(snapshot: SnapshotContent): ParseResult; // pure: mentions + claims + discovered URLs
}
```

`parse` must be pure and fixture-testable. Every adapter ships with: `docs/sources/<name>.md` (URL patterns, robots/ToS notes, auth requirements, cadence, known quirks), recorded fixtures, and tests.

Candidate seed sources (verify each exists, is public, and is permitted before building — do **not** assume URLs or structures):
- Official Harvard College student organization directory / Dean of Students organization pages
- SEAS student organization listings; academic department org lists
- Harvard Recreation / Athletics club sports
- PBHA and other public service program listings
- Institute of Politics affiliated organizations
- Arts / performing arts listings (e.g. Office for the Arts), publication lists
- Harvard Crimson references (mentions → candidate orgs & corroboration)
- Search engine discovery (via an official search API, not SERP scraping)
- Public Instagram / LinkedIn / Linktree — **link discovery only**, see §21

Many Harvard systems require HarvardKey. **We do not scrape authenticated pages.** If the best data is behind login, the path is to request an export/permission from the owning office, or have a human record facts manually with a citation.

---

## 11. Ingestion pipeline

Stages are separate modules with typed inputs/outputs; each can run independently and is idempotent:

1. **Discover** — adapters emit seed URLs and entity mentions.
2. **Fetch** — politeness-aware fetcher writes `fetch_attempt` + `source_snapshot` (blob store).
3. **Parse** — deterministic: HTML → structured blocks/text (Cheerio), JSON-LD/OpenGraph/meta, known page templates.
4. **Extract** — deterministic field extractors first; LLM extraction only for unstructured semantic content.
5. **Entity resolution** — mentions → clubs (§12).
6. **Claim creation** — upsert claims + evidence (idempotent unique keys).
7. **Reconcile/resolve** — resolver builds computed values, derived classifications, projections.
8. **Index** — rebuild `club_search_document`.
9. **Present** — Next.js reads projections only.

### 11.1 Fetching rules
- Identify honestly: `User-Agent: hclubsBot/<ver> (+<site>/about/bot; <contact email>)` from env.
- Honor `robots.txt` (cached per host, re-checked daily) including `Crawl-delay`. Disallowed ⇒ skip and log.
- Per-host concurrency 1, default min interval ≥ 2 s, jittered; global concurrency cap.
- Conditional requests (`If-None-Match` / `If-Modified-Since`).
- Exponential backoff with jitter on 429/5xx/network errors; honor `Retry-After`; bounded retries; failures recorded and retryable by rerunning the job.
- Max response size (e.g. 10 MB), timeouts, content-type allowlist.
- URL normalization (lowercase host, strip fragments and tracking params like `utm_*`, `fbclid`, `igshid`, normalize trailing slash) in one tested function.
- **Static fetch (undici/fetch + Cheerio) by default.** Playwright only for adapters that declare `requiresBrowser: true` with a documented reason.
- Never log in, bypass paywalls, solve CAPTCHAs, rotate IPs/user agents to evade blocks, or ignore explicit anti-bot signals. Blocked ⇒ stop and document.

### 11.2 Snapshot storage
- Blobs are content-addressed (`sha256`) in an object store behind a `SnapshotStore` interface: local filesystem (`data/snapshots/`, gitignored) in dev; S3-compatible (R2/S3/Supabase Storage) in prod. Postgres stores metadata only.
- Store raw bytes + extracted text. Compress (gzip/zstd).
- Retain snapshots unless a takedown or legal reason requires removal (removal is logged; claims keep a tombstoned evidence reference).

### 11.3 LLM extraction rules
- Input: cleaned text of one snapshot (+ minimal context such as the resolved club name). Output: Zod-validated JSON matching the field registry.
- **Every extracted value must include a verbatim evidence quote.** The pipeline verifies the quote exists in the snapshot text (whitespace/Unicode-normalized). No quote match ⇒ rejected (or, only for fields with `allowInferred`, stored as `inferred` with reduced confidence).
- **Numbers, dates, and money must appear literally in the quote.** An LLM may not compute, round, or infer them.
- The model must be able to answer "not stated"; prompts explicitly reward returning null.
- Record `llm_model`, `prompt_version`, temperature (0), and cache results by `(text_sha256, extractor_version, prompt_version, model)` so reruns are free and deterministic.
- Model ID is configured by env (`EXTRACTION_MODEL`), never hard-coded in multiple places. Per-run cost/token budget with hard stop.
- Prompts live in versioned files under `packages/pipeline/src/extract/prompts/`, with golden-fixture tests.

### 11.4 Jobs
- CLI entry: `pnpm pipeline <job> [--adapter x] [--club slug] [--dry-run] [--limit n]`.
- Every job creates an `ingestion_run`, logs structured JSON (pino), tolerates partial failure (one bad source never aborts the run), and ends with a stats summary.
- Initially run locally; later GitHub Actions cron / a worker. No queue infrastructure until needed.

---

## 12. Entity resolution

Signals: normalized name, acronym, aliases, official domain, social handles, Harvard directory identifiers, description similarity (trigram / token overlap; embeddings only if proven necessary).

Name normalization (tested, in `packages/core`): Unicode NFKC, lowercase, `&`→`and`, strip punctuation, collapse whitespace, remove common noise tokens for **blocking only** (`harvard`, `college`, `undergraduate`, `hc`, `the`, `club`, `society`, `association`, `organization`) — but keep the full normalized name for scoring, because those tokens can distinguish real orgs (see §3 pitfall).

Decision policy:
- **Auto-link** only on a strong identifier: same Harvard directory ID, same established official domain, or same established social handle — and no contradicting strong identifier.
- **High-similarity name match without a strong identifier** ⇒ `club_merge_candidate` / `pending` mention for human review. Never auto-merge on name similarity alone.
- **New club** only when no candidate exceeds the review threshold.
- Merge: loser `record_state = merged`, `merged_into_club_id` set, slug redirects. Claims keep their original `subject_id`; the resolver follows the merge chain. This makes **splits** reversible without rewriting history.
- Supported states: duplicate candidate → proposed merge → confirmed merge; alias; split.

All thresholds and the matcher are versioned; resolution decisions record the version and signals.

---

## 13. Search & filtering

- Search: PostgreSQL full-text (`tsvector`, weighted: name/acronym/aliases A, categories/tags B, short description C, long description D) + `pg_trgm` similarity for fuzzy/typo/acronym matches + `unaccent`. Materialized in `club_search_document` with GIN indexes.
- Ranking: exact acronym/alias match ≫ name prefix ≫ FTS rank ≫ trigram similarity; demote inactive/merged/hidden.
- All search goes through a `SearchProvider` interface so Typesense/Meilisearch can be added later **only if measured necessary**.
- **Instant client-side filtering:** for the directory page we may ship a compact precomputed index (id, slug, name, acronym, aliases, categories, filter attributes) when it stays small (target < ~300 KB gzipped) so filtering/sorting feels instant, QViewer-style. Postgres remains the canonical query path (and the fallback).
- Filters (all driven by registry fields): category/subcategory, join mode (open / application / comp / audition / tryout / invite-only), currently recruiting, deadline window, recruiting term, freshmen eligible, hours/week range, membership size bucket, selectivity (derived; "Unknown" is a filterable bucket, never silently excluded), recognition status, activity status, dues (none / some / unknown), affiliation scope.
- Filter state lives in the URL (shareable, back-button friendly).

---

## 14. Community contributions & comp outcome reports

Build later; schema must not make them painful.

**Contribution types:** suggest an edit, submit updated link, submit recruiting deadline, report inactive club, vote data outdated, claim/manage a club page, anonymous comp outcome, anonymous approximate applicant count / cohort size.

- `student_submission` — `id`, `kind`, `subject_type`, `subject_id`, `payload` jsonb (Zod schema per kind), `evidence_url` (optional), `submitter_ref` (nullable, opaque), `status` (`pending` | `accepted` | `rejected` | `spam`), `reviewed_by`, `reviewed_at`, `resulting_claim_ids[]`. Accepted submissions become claims with `source_type = student_submission` (tier 9) or, if they include a verifiable official URL, trigger a fetch of that URL so the fact is backed by a real snapshot.
- Club managers (`club_manager_role`, verified via an official club email or editorial check) submit claims as `club_recruiting_material`-equivalent tier with `editorial` provenance — still claims, still auditable.
- Auth (when built): Harvard email verification (magic link). No passwords stored.
- Anti-abuse: rate limits, moderation queue, per-user caps, anomaly checks.

**Comp outcome reports** (`comp_report`): club, recruiting cycle, class year (coarsened), applied, furthest stage reached, accepted, approx applicants known (optional), approx cohort size known (optional), perceived hours spent, optional notes (moderated before any display; never displayed verbatim by default).
- **No foreign key from `comp_report` to a user.** Dedupe/rate limiting uses a separate table with a keyed hash (HMAC with a server secret) of the verified identity per cycle — not reversible without the secret, rotated per cycle.
- Aggregates are shown only when `n ≥ k` (start `k = 5`) per cycle, and with coarsening such that no individual outcome can be inferred (e.g. do not show "1 of 5 accepted" breakdowns by class year).
- Never expose PII. Never display individual reports.

---

## 15. UI requirements

Routes (Next.js App Router):
- `/` — prominent search, category entry points, **Recruiting now**, upcoming deadlines, useful discovery sections (e.g. "No comp required", "Open to first-years", "Low time commitment"), filter access.
- `/clubs` — search, filters, sorting, dense list (default) + card view toggle, infinite scroll or pagination, responsive.
- `/clubs/[slug]` — name, acronym, logo, badges, description, categories/tags, official links, **How to join** (join mode, current cycle, deadlines, stages), time commitment, membership, eligibility, selectivity evidence, activities/projects, data freshness, **Sources** panel (every claim → source, observed date, badge), "Suggest a correction."
- `/compare?clubs=a,b,c` — side-by-side (2–4): category, org type, join mode, comp process, selectivity evidence, hours/week, member count, deadline, eligibility, major activities. Unknowns shown explicitly.
- `/recruiting` — open now, upcoming deadlines, recently closed, filter by term.
- `/contribute` — clubs known only by name, each with a prefilled "Add info" form link (ADR 0030).
- `/categories/[slug]`, `/about`, `/about/methodology` (how we source, badges, confidence, resolver rules — generated partly from the registry), `/about/bot` (crawler info + opt-out/takedown contact).

Rendering (ADR 0022): the site is a static export. Profile/category/about pages are prebuilt from the local DB; the directory, search, filters, compare and recruiting board run in the browser over `/data/index.json` via the pure `@hci/db/local` module (parity-tested against Postgres). Anything depending on "now" is recomputed client-side after mount (`useNow`). No server mutations until M5 brings a server back; corrections go by email/form.

Every dynamic field in the UI renders through one `<FieldValue>` component that takes the projection metadata. No ad-hoc rendering of claimable fields. Per ADR 0028 it shows the plain value (no badge, freshness or popover). Profiles show all non-rejected links (including unverified social accounts) as an icon bar under the name.

---

## 16. Design direction

- Polished student-built product, not enterprise dashboard. Clean, fast, minimal, **information-dense**.
- Excellent typography (one sans family, tabular numerals for numbers), tight but readable spacing, strong hierarchy.
- Mobile-first; the directory and profile must be fully usable one-handed on a phone.
- Useful badges (join mode, recruiting now, first-years OK, freshness), not decorative ones.
- Keyboard: `/` focuses search, arrow navigation in results, `Esc` clears.
- Designed empty, loading (skeletons), error, and "Unknown" states.
- Light + dark mode. WCAG AA contrast. Accessible names on all controls.
- Conceptual inspiration from QViewer's simplicity and utility; do not copy its implementation, branding, or assets.
- Do not use Harvard shields/logos or imply official status (§21).

---

## 17. Data freshness

- Every displayed dynamic field is traceable to source, observed date, and (where relevant) recruiting cycle.
- Staleness threshold per registry `volatility`; stale fields get a subdued "as of <date>" and downgrade from Verified → Reported.
- Recheck cadences (initial defaults; per-source overrides in `source.recheck_policy`):
  - active recruiting pages / application pages: daily during recruiting windows, weekly otherwise
  - deadlines: daily during recruiting windows
  - Harvard directories: weekly
  - club homepages: monthly
  - social/link-in-bio pages (link check only): monthly
  - stable descriptions: each semester
- A `recheck` job selects due sources by policy; conditional requests keep it cheap.
- Activity status degrades automatically (e.g. no observed activity for 2+ semesters ⇒ `possibly_dormant`, computed and labeled as such).

---

## 18. Technology stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, pnpm workspaces |
| Web | Next.js (App Router), React, TypeScript strict, Tailwind CSS |
| DB | PostgreSQL 16+ with `pg_trgm`; Drizzle ORM + drizzle-kit migrations (committed); `postgres-js` driver with `prepare: false` |
| Validation | Zod at every external boundary (HTTP input, fetched data, LLM output, env) |
| Scraping | native `fetch`/undici, Cheerio; `playwright-core` driving installed Chrome only for JS-only pages (`enrich --browser`) |
| LLM | Anthropic API (Claude) for semantic extraction only; model via env |
| Logging | pino (structured JSON) |
| Testing | Vitest; parser fixtures; integration tests against a real Postgres (docker compose), not mocks |
| Lint/format | ESLint (typescript-eslint, flat config) + Prettier |
| Local infra | `pnpm db:start` — PGlite (WASM Postgres) behind a batch-safe wire-protocol server (ADR 0013); or `docker-compose.yml` Postgres 17. Tests use in-process PGlite. |
| Deploy | Static export (`next build` → `apps/web/out`) generated from the local DB, published to GitHub Pages or any static host (ADR 0022). No hosted server or database. |
| Jobs | Local CLI first; GitHub Actions cron later |

Adding a dependency requires a reason (in the PR/commit message). Prefer the platform and existing deps.

---

## 19. Repository layout (target)

```
apps/
  web/                    Next.js app (UI components live here until a second consumer exists)
packages/
  core/                   Pure domain: field registry, Zod schemas, enums, normalization
                          (names, URLs, handles, terms), confidence fn, resolver (pure), types
  db/                     Drizzle schema, migrations, query helpers, SnapshotStore,
                          fixture seed (clearly marked)
  pipeline/               Ingestion: CLI + stages
    src/fetch/ snapshots/ parse/ entity/ stages/ cli.ts   (claims + reconcile live in @hci/db)
    src/adapters/<name>/  One folder per source adapter (+ docs/sources/<name>.md)
    test/fixtures/        Recorded snapshots for parser/extractor tests (small, redistributable)
data/                     Local-only artifacts (snapshots, exports) — gitignored except README
docs/
  decisions/              ADRs: NNNN-title.md
  sources/                Per-source notes: URL patterns, robots/ToS, auth, cadence
scripts/                  One-off dev scripts
```

Notes:
- `packages/ui`, `packages/search` are created only when a second consumer or a real alternate implementation exists (avoid premature packages).
- Do not commit large scraped datasets or snapshot blobs. Fixtures are small, trimmed, and only from sources where redistribution in a test fixture is reasonable.

**Commands** (keep this list accurate):
```
pnpm install
pnpm db:start               # zero-install dev Postgres (PGlite) on 127.0.0.1:54320 — keep running
pnpm db:migrate             # apply migrations;  pnpm db:generate after schema changes
pnpm db:seed                # taxonomy + fictional demo clubs (local only); --taxonomy-only for real-data DBs/prod
pnpm db:reset               # drop + migrate (local only)
pnpm dev                    # web app on :3000 against the local DB (/admin/review and /admin/audit exist only here)
pnpm --filter @hci/web build    # static site → apps/web/out (needs db:start running)
pnpm --filter @hci/web preview  # serve out/ on :4173 like a static host
scripts/publish-pages.sh michaellhan/hci ""          # build + publish to hclubs.app via GitHub Pages (docs/deployment.md)
scripts/refresh.sh [--weekly] [--no-publish]         # crawl what's due, LLM on changed pages ($1 cap), reconcile, republish (ADR 0029)
scripts/install-refresh.sh [--remove]                # launchd: daily 6:00 refresh, Sundays --weekly

pnpm ingest:discover        # all discovery adapters (official first); --source=a,b  --offline
pnpm ingest:find-sites      # find websites for clubs with none: guessed domains (+ --search via Brave API), page must name the club
                            #   --instagram: batched site:instagram.com search (5 clubs/query); --loose: unquoted second phrasing
pnpm hci reject-link <slug> <url> --reason="…"   # reject a wrong link on a club (audited, reversible via claim status)
pnpm hci discover-web --search --outlinks   # find clubs no directory lists: topic search sweeps + links on crawled pages (ADR 0025)
pnpm hci name-only [--search-budget=N] [--limit=N] [--dry-run]   # name-only campaign: duplicates, free evidence, capped search; data/reports/name-only-review.md (ADR 0032)
pnpm hci audit [--apply] [--check=links,content,…] [--check-urls]   # data-quality audit: data/reports/audit.{json,md}; --apply fixes high-confidence findings only (ADR 0033)
pnpm hci recruiting [--missing-only|--stale-only] [--search-budget=N] [--no-ai] [--budget=USD] [--dry-run|--audit-only]   # targeted recruiting pass + quality audit (ADR 0031, docs/recruiting.md)
pnpm hci import-soco data/imports/soco.txt   # the owner's hand-saved copy of the SOCO directory (never fetched; ADR 0030)
pnpm hci curate [--dry-run] # apply the editor's club list (packages/pipeline/src/curated/list.ts, ADR 0024)
pnpm hci press [--publisher=crimson,independent,hpr] [--refresh]   # student-newspaper articles naming each club (headline/date/link; ADR 0026-0027)
pnpm hci summarize [--budget=USD] [--refresh]   # one-line club summaries anchored to the club's own text (SUMMARY_MODEL; ADR 0029)
pnpm hci categorize [--budget=USD]   # grounded LLM categories for clubs with none / no subcategory (estimates; ADR 0026)
pnpm hci submissions import <csv> | list | accept <id> --field=… --value=… | reject <id>   # community form responses → reviewed Community claims (ADR 0027)
pnpm ingest:enrich          # verify websites, crawl, extract; --club=slug --limit=N --stale-only --force --llm --llm-dry-run --budget=USD --browser
pnpm ingest:reconcile       # cross-club dedupe (strong ids only) + re-resolve everything; --dry-run
pnpm ingest:stats           # coverage report
pnpm ingest:export          # JSON/CSV to data/exports (public data only)
pnpm hci <cmd>              # full CLI: adapters | parse | discover | discover-web | find-sites | curate | press | crimson | categorize | submissions | enrich | reconcile | resolve | review | merge | unmerge | hide | unhide | reject | runs | stats | export

pnpm test                   # all Vitest suites (unit, fixtures, integration via in-process PGlite)
pnpm typecheck && pnpm lint && pnpm build   # or: pnpm check
```
(`hci`, not `pipeline`: pnpm 12 reserves `pnpm pipeline`.)

**Environment variables** (documented in `.env.example`; never commit real values):
Implemented: `DATABASE_URL`, `PGLITE_PORT`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_PATH` (static site sub-path), `CONTACT_EMAIL` (public corrections/takedown/crawler contact — a project address, never personal), `NEXT_PUBLIC_CORRECTIONS_FORM_URL` (optional corrections form), `SNAPSHOT_DIR`, `CRAWLER_USER_AGENT`, `CRAWLER_CONTACT`, `CRAWLER_MIN_INTERVAL_MS`, `LOG_LEVEL`, `EXTRACTION_MODEL` (default `claude-opus-5-5`), `EXTRACTION_EFFORT` (default `low`), `EXTRACTION_BUDGET_USD`, `SUMMARY_MODEL` (default `claude-sonnet-5-5`), `REFRESH_LLM_BUDGET` (refresh.sh; default 1), `ANTHROPIC_API_KEY` (optional; SDK credential resolution also accepts an `ant auth login` profile). `BRAVE_SEARCH_API_KEY` (optional; enables `find-sites --search`, `discover-web --search` and Crimson press mentions; the key draws on **prepaid** Brave credit; every command caps billed queries with `--max-queries`, default 100, and `stats` shows `braveQueriesThisMonth`). `NEXT_PUBLIC_CONTRIBUTE_FORM_URL` and `NEXT_PUBLIC_CLUB_MANAGER_FORM_URL` (optional https form links for "Share what you know" / "Run this club?"; `{club}` and `{slug}` are substituted; fallback is a mailto to `CONTACT_EMAIL`).
Planned: `SNAPSHOT_STORE` (`fs`|`s3`), `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SUBMISSION_HMAC_SECRET` (M5, when a server exists).
Env is parsed with Zod at startup; missing required vars fail fast with a clear message.

---

## 20. Engineering standards

- TypeScript `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any` (use `unknown` + Zod); no non-null `!` without a comment justifying it.
- Zod at all external-data boundaries; infer types from schemas.
- Strong DB constraints: FKs, `NOT NULL` by default, unique keys for idempotency, check constraints for enum-like text and state invariants. Migrations generated and **committed**; never edit an applied migration.
- Pure core, effectful edges: normalization, parsing, extraction post-processing, confidence, resolver, entity scoring are pure functions with unit tests.
- Idempotent jobs: rerunning any job with the same inputs creates no duplicates.
- Graceful partial failure; meaningful structured logs (run id, adapter, source id, url).
- Scrapers/parsers testable from fixtures with no network. Tests never hit the live web.
- Time is injected (`now` param / clock) in logic that depends on it.
- Readable modular code; small files; explicit names. Comments explain *why*.
- No secrets in git. No generated build artifacts in git.
- Avoid premature distributed systems, microservices, queues, caches, and search clusters.
- **Definition of done** for a milestone: typecheck, lint, and tests pass; migrations committed; docs (this file, ADRs, `docs/sources/*`) updated; no TODOs hiding broken behavior; no fake data outside fixtures.

---

## 21. Legal, ethical & privacy constraints

- **Robots/ToS:** honor robots.txt and site terms. Each adapter's `docs/sources/<name>.md` records the ToS/robots review and date.
- **Authenticated content:** never scrape pages behind HarvardKey or any login. Never use a personal account/session for crawling.
- **Social platforms (Instagram, LinkedIn, Facebook, TikTok, X):** their terms prohibit automated scraping and they actively block it. We do **not** scrape them. We store *links* to official accounts (discovered from club websites / Harvard directories) and may record facts from them only via (a) official APIs within their terms, (b) manual human entry with a citation, or (c) club/student submissions. Linktree-style pages: fetch only if robots permits, at link-check cadence.
- **Google Forms / application portals:** link to them; never submit, never scrape responses; read only publicly visible form descriptions if permitted.
- **Copyright:** snapshots are internal evidence. Public UI shows our own summaries, short attributed quotes, and links — not republished articles or club copy wholesale. Crimson content: link + short quote only.
- **Logos/images:** display club logos only from official sources with attribution; honor removal requests promptly.
- **Harvard trademarks:** the product is independent. Do not use Harvard shields/marks or imply endorsement; include a clear "not affiliated with Harvard University" disclaimer. The public name is **hclubs** (ADR 0021, second amendment). "Harvard" appears only descriptively (e.g. "Harvard student clubs"), never as part of the brand or domain. Never use Harvard insignia, crimson-and-shield styling or the Veritas mark, and keep the not-affiliated notice.
- **Privacy:** no individual rosters, officer contacts, or personal emails in v1. Comp reports anonymous with k-thresholds (§14). Social/invite-only organizations: only publicly available, organization-level information; nothing about individual members.
- **Accuracy / reputational harm:** selectivity and activity labels are evidence-backed and marked derived; clubs can request correction via `/about` contact and "Suggest a correction."
- **Takedowns:** documented process; removals logged in `editorial_decision`.

---

## 22. Roadmap & milestones

Work on **one milestone at a time** to a finished state.

- **M0 — Specification** ✅
- **M1 — Foundation** ✅ (2026-09-30). pnpm monorepo; strict TS/ESLint/Prettier/Vitest; Drizzle schema + migrations (claims/evidence, snapshots, runs, mentions, merge candidates, cycles, stages, membership estimates, submissions, editorial log, projections, search document); field registry; pure resolver + projection writer; Postgres FTS/trigram `SearchProvider`; web app (`/`, `/clubs` with URL filters/sort/search, `/clubs/[slug]` with provenance badges + sources, `/compare`); pipeline (polite fetcher, robots, content-addressed snapshots, conservative entity resolution, CLI); first adapter `pbha-programs` (live-verified: 60 programs, idempotent re-run via 304s); 21 fictional fixture clubs; 100+ tests.
  - Source survey (2026-09-30): College org directory (SOCO/CampusGroups) requires HarvardKey → excluded; DSO + OFA sites return Akamai 403 to our crawler → not bypassed; SEAS student-orgs page public (names + links); club sports page public (names only); IOP programs public; PBHA public (chosen). See ADR 0016.
- **M2: Discovery & enrichment** ✅ (2026-09-30).
  - **Adapters (12 in M2; Hillel added after):** PBHA, SEAS (×2), SOCO club sports, IOP, CS advising, MCB, Latinx Studies, Math community, Mignone career center, Innovation Labs, Wikipedia (tier 8). Source notes are in `docs/sources/`.
  - **Entity resolution:** candidate mentions, matcher-v2 (definite/probable/ambiguous/new with persisted explanations), and reversible, audited merges (ADR 0019).
  - **Link verification:** a candidate-and-verification model (ADR 0017), plus a directory-page pass that reads club links from Harvard pages about the club.
  - **Crawler:** shallow, role-prioritized, incremental (freshness window, conditional GET, content hashes).
  - **Extraction:** the page normalizer, deterministic extractors, and optional LLM extraction with grounding, cache and budget (ADR 0018).
  - **Time parsing and activity:** a Harvard time/semester parser, and a derived activity heuristic (ADR 0020).
  - **Web:** a `/recruiting` board, provenance-rich profiles, and the dev-only `/admin/review`.
  - **Tooling:** JSON/CSV export, a coverage `stats` report, and per-run observability counters.
  - The official College directory (SOCO/CampusGroups, about 533 orgs) remains behind HarvardKey. See `docs/sources/README.md`.
- **Launch prep** ✅ (2026-09-30). `/about`, `/about/methodology` (generated from the field registry), `/about/bot`, `/categories/[slug]`, "Suggest a correction" (email/form link), `robots.txt` + `sitemap.xml`, crawler renamed `ClubIndexBot`, trademark review (ADR 0021), static export with client-side search (ADR 0022), `scripts/publish-pages.sh` + `docs/deployment.md`. Not yet published.
- **Coverage pass** (2026-09-30):
  - **Crawler fix:** its failure budget used the run-wide counter, so a few dead sites early in a run stopped every later crawl. It is now per site.
  - **Directory pages:** one per directory site, up to 4. Wikipedia articles are no longer crowded out.
  - **Wikipedia infobox:** its "Website" row is now read (extractor 1.3.0).
  - **New adapter:** `hillel-student-groups` (tier 7).
  - **Survey of other offices:** most Harvard office listings are Akamai-blocked or gone; see `docs/sources/README.md`.
  - **HarvardKey-gated SOCO directory:** still excluded (§10, §21).
  - **Coverage:** website 20%→26%, description 66%→77%, how to join 4%→8%, recruiting 1%→3%.
  - **First LLM run** (M3 item 3; ADR 0018 update):
    - Scale and cost: 74 calls, $2.10, 499 grounded claims.
    - Coverage: how to join 8%→10%, recruiting 3%→4%, member count 2%→4%.
    - Replies are now JSON in text, validated locally, because the API's constrained output rejected the schema.
    - Stage labels must appear verbatim in the page text.
- **M3: Coverage depth (in progress).** First pass (2026-09-30):
  - **Website finder** (`find-sites`, ADR 0023):
    - Candidates come from guessed domains (DNS-checked) and the Brave Search API (`--search`).
    - A candidate is accepted only if a heading segment of its fetched page is the club's name (finder v2).
    - `--recheck` re-tests earlier finds against the current rules.
    - Social profiles found by search stay unverified (35% of clubs have an Instagram at any status; 10% verified).
  - **LLM on directory pages** (PBHA/IOP/Mignone/Wikipedia pages about a club): $4.05, 1,024 new grounded claims. The grounding revision is now separate from the prompt version (ADR 0018 update).
  - **Browser fallback** (`enrich --browser`, `playwright-core` + installed Chrome) for JS-only pages; it keeps a render only if it's under 10 MB and adds text.
  - **Fixes:** stale membership rows after merges broke re-resolution; `retract-unreproduced` now only considers re-extracted snapshots and takes `--field`; the crawler skips cart/account/login pages.
  - **Coverage:** website 26%→39%, how to join 10%→25%, member count 3.5%→7.3%, recruiting 4.1%→5.9%, description 77%→80%. LLM spend $4.80.
  - **SOCO:** never crawled, including web-archive enumeration. Superseded by ADR 0030: the owner's hand-saved copy of the directory is imported with `import-soco` (no officer names).

  Second pass (2026-09-30), prompted by a student's list of 40 clubs where 18 were missing:
  - **Curated list** (`curate`, ADR 0024): editor-supplied names and links. Websites are verified by fetching and must name the club; Instagram links are recorded but never fetched. Added 18 clubs plus sites for existing ones. `hide`/`unhide` were added for out-of-scope rows.
  - **Web discovery** (`discover-web`, ADR 0025): Brave topic sweeps (about 130 queries) plus links from about 1,100 crawled pages. It probed 222 candidate sites and created 19 clubs; 2 false positives were hidden and the rules tightened.
  - **Matcher v3:** fuzzy name similarity uses only the distinctive words, plus a containment check for partial names. Shared "Harvard Undergraduate … Club" boilerplate no longer flags unrelated clubs as duplicates.
  - **Crawling:** enrichment treats HCS-hosted `*.hcs.harvard.edu` sites as club sites. `enrich --club` takes a comma-separated list.
  - Duplicate pairs merged: HODP ×2 and AI Safety Student Team ×2.

  Third pass (2026-09-30):
  - **Crawling:**
    - Club sites on Harvard subdomains are crawled when their link is verified.
    - Sitemap hints seed each crawl.
    - Application forms are read as title + public description only (ADR 0027).
    - `enrich --browser` rendered 42 JS-only pages.
  - **LLM:** up to 6 pages per club (never team pages), prompt v4. `club.recruiting_seasons` is added via the deterministic extractor and the LLM (ADR 0026).
  - **Categorize:** grounded LLM categories for 126 clubs, shown as estimates.
  - **Press mentions:** from The Crimson (Brave), the Independent and the HPR (WordPress search APIs). Student names are redacted from evidence quotes, and mentions count toward the activity heuristic (`activity-v2`).
  - **Web discovery:** a second sweep (3 phrasings, about 190 topics) added 13 clubs. 4 non-student orgs were hidden, and commercial/clinic/grad-journal rules were added.
  - **UI:**
    - Empty sections are hidden, with a "What we know" summary and a "Not yet known" line.
    - Categories are labeled as estimates.
    - Profiles gain an "In the news" section and the usual recruiting term.
    - /recruiting gains "Usually recruits this term", and the directory a season filter.
    - Contribute and club-manager prompts were added, with the Sources column renamed to "Details".
  - **Community submissions:** an import/review pipeline (ADR 0027).
  - **LLM spend:** about $12.25 this pass (enrich $9.67, categorize $1.55, forms/sitemap $1.03).
  - **Fourth pass (2026-09-30):**
    - Contact is `hclubsapp@gmail.com`; the feedback Google Form is wired to every contribute, correction and footer link.
    - A spot check rejected 20 wrong search-matched Instagram links, and Instagram `/popular/` paths are no longer read as profiles.
    - The curated list can assign categories (all clubs now have one).
    - Club sports get a plain one-line summary ("Harvard club sports team for archery."). Summaries fall back to a club's own home page.
    - The directory hides clubs with no description and no website/Instagram unless searched or "show all".
  - **Blocked:** the Brave prepaid credit ran out mid-run (HTTP 402). The Crimson covers only about 75 clubs until it's topped up. `CONTACT_EMAIL` isn't set yet, so the site's contribute and correction buttons read "open soon".

  Remaining items:
  1. Request a sanctioned export of the official student-organization list from the College Student Engagement Office / DSO (the single highest-value source).
  2. Detail pages for the directory adapters that link them (Mignone and IOP pages are read by the directory pass; add per-program PBHA descriptions to adapters).
  3. Run LLM extraction (`--llm`) under a budget on crawled pages that have recruiting/join roles; measure the grounded-claim yield and rejection rate.
  4. Crimson name-matching extractor (tier-6 historical evidence) using the canonical club index as a gazetteer.
  5. Optional Playwright fetcher for pages flagged `needs_browser`, behind a flag.
  6. A scheduled `ingest:enrich --stale-only` plus deadline rechecks during recruiting windows (GitHub Actions).
  7. Scheduled refresh + republish of the static site (local or CI with a DB snapshot).
- **M4 — Recruiting.** Groundwork done (2026-09-30, ADR 0031): `recruiting` pass, past-term suppression, recruiting quality audit; coverage numbers in `docs/recruiting.md`.
  Remaining: scheduled `recruiting --stale-only` rechecks during recruiting windows; deadlines for clubs without public recruiting pages (submissions).
- **Data-quality audit** (2026-10-01, ADR 0033): `pnpm hci audit` (pure check groups over the whole DB, ranked findings, high-confidence fixes only). Results:
  - Rejected 150 wrong or unsupported claims: 62 links, 22 recruiting dates, 20 descriptions/summaries, 17 join modes/dues, 12 activities, 11 member counts/hours, 6 logos.
  - Merged 7 duplicate pairs.
  - Shared evidence rules now apply in both extractors (deterministic 1.7.0, LLM `g5`).
  - Resolver-v2, `summary-v2`, Facebook page URLs fixed, deep links on shared hosts kept as they are.
  - What remains for review is in `data/reports/audit.md`.
- **M5 — Contributions.** Suggest-an-edit, link/deadline submissions → moderation queue → claims; Harvard email auth.
- **M6 — Comp outcome reports** with k-anonymity aggregation.

## 23. Agent behavior rules

When working in this repository:

1. **Read `CLAUDE.md` first.** Then inspect existing code and `docs/decisions/` before any major change.
2. Do not replace working architecture without explaining why and recording an ADR.
3. Finish one coherent milestone rather than starting several incomplete features.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (and integration tests when DB code changed) before declaring anything complete. Report failures honestly.
5. Fix issues you introduce. Don't leave the tree broken.
6. Keep docs updated in the same change: this file (commands, env vars, schema changes, milestone status), `docs/sources/*`, ADRs.
7. Record major design decisions in `docs/decisions/NNNN-title.md` and add a line to §24.
8. **Never fabricate external facts.** If unsure whether a Harvard office, URL, directory, or club detail exists, verify it or leave it unknown. Do not "fill in" club data from memory — model knowledge is not a source.
9. **Never populate production-looking fake club data.** Fixtures/demo data are fictional organizations (never real clubs with invented facts), slugs prefixed `fixture-`, `data_origin = 'fixture'`, sources on the reserved `.invalid` TLD with `is_fixture = true`, a visible "Demo data" label, and the seed script refuses non-local databases (ADR 0015).
10. New claimable field ⇒ registry entry first. New source ⇒ adapter + `docs/sources/<name>.md` + fixtures + tests, with robots/ToS reviewed.
    Never change an existing adapter's `externalKey`/external-id scheme: ids in the same namespace that differ mean *different organizations*, so a scheme change mass-creates duplicates. Add new identifiers under a new namespace (e.g. `wikipedia-article`).
    After fixing an extractor, bump its version, re-run it, then `pnpm hci retract-unreproduced --extractor=<name> --version=<current> [--field=<keys the fix touched>]` (claims are rejected with a reason, never deleted; only claims whose own snapshot the new version re-extracted are considered). For stricter LLM grounding without a prompt change, bump `GROUNDING_REVISION` so reruns replay from cache for free.
11. Never write projection tables from ingestion code. Never mutate snapshots. Never hard-delete claims (change `status`).
12. Don't commit secrets, `.env`, snapshot blobs, large datasets, or build output. Commit migrations.
13. Prefer small, reviewable commits with descriptive messages.
14. Run `pnpm hci audit` after an ingestion run and before publishing. `--apply` fixes only high-confidence findings; read a new rule's output against live data before letting it attach a fix, and add a regression fixture for every bug class it catches (ADR 0033).

---

## 24. Decision log

Decisions 0001–0012 were made during M0 and are recorded only in this table. From 0013 on, each decision gets a file in `docs/decisions/` plus a row here.

| # | Decision | Rationale |
|---|---|---|
| 0001 | Claims + evidence architecture; projections are rebuildable read models | Provenance, conflicts, temporal scope, rebuildability (§5) |
| 0002 | Field registry as single source of truth for claimable fields | Keeps extractors, resolver, UI, filters consistent (§6) |
| 0003 | `claim` = unique assertion; `claim_evidence` = each observation | Idempotent re-ingestion; corroboration without duplicate claims |
| 0004 | Computed values and derived classifications are separate tables from claims | Principle 2.4 |
| 0005 | Recruiting cycle is an identity row; its attributes are claims | Temporal correctness (§8) |
| 0006 | Snapshots content-addressed in object storage; metadata in Postgres | Immutable raw data without bloating the DB |
| 0007 | LLM extraction requires verified verbatim quotes; numbers/dates must appear literally | Prevents hallucinated facts (§11.3) |
| 0008 | Auto-merge entities only on strong identifiers; merges non-destructive via merge chain | Reversible merges/splits (§12) |
| 0009 | Postgres FTS + pg_trgm behind `SearchProvider`; optional compact client index | Fast enough at this scale; swappable later (§13) |
| 0010 | No scraping of social platforms or authenticated Harvard systems | Legal/ToS (§21) |
| 0011 | Single `pipeline` package with stage modules instead of one package per stage | Avoid premature packaging (§19) |
| 0012 | No individual rosters/officer PII in v1; comp reports unlinkable to users with k≥5 aggregation | Privacy (§14, §21) |
| 0013 | Zero-install PGlite dev DB behind a batch-safe wire-protocol server; one `postgres-js` driver path | `docs/decisions/0013-pglite-dev-database.md` |
| 0014 | Resolved display columns live on `club` (resolver-only), not a separate `club_profile` table | `docs/decisions/0014-projection-columns-on-club.md` |
| 0015 | Fixtures are fictional orgs loaded through the claims path, clearly labeled | `docs/decisions/0015-fictional-fixtures.md` |
| 0016 | First adapter: PBHA programs directory (official College directory requires HarvardKey) | `docs/decisions/0016-first-adapter-pbha.md` |
| 0017 | Links are candidates until verified (verified / probable / unverified) | `docs/decisions/0017-candidate-and-verification-links.md` |
| 0018 | LLM extraction optional, grounded (verbatim quotes, literal numbers), cached, budgeted, provider-agnostic | `docs/decisions/0018-llm-extraction-discipline.md` |
| 0019 | Reversible audited merges; auto-merge only on strong identifiers | `docs/decisions/0019-reversible-merges.md` |
| 0020 | Activity status is a derived conservative estimate with confidence and reasons | `docs/decisions/0020-activity-heuristic.md` |
| 0021 | Public name and Harvard trademark (second amendment: renamed **hclubs**; Harvard only descriptive) | `docs/decisions/0021-public-name-and-trademark.md` |
| 0022 | Static site: prebuilt pages + client-side search over a JSON index; no hosted server/DB | `docs/decisions/0022-static-site.md` |
| 0023 | Website discovery: guessed domains + official search API as candidates; accepted only when the fetched page names the club (probable) | `docs/decisions/0023-website-discovery.md` |
| 0024 | Owner-curated club list: editorial links verified by fetching, Instagram recorded unfetched; `hide`/`unhide` | `docs/decisions/0024-curated-club-list.md` |
| 0025 | Web discovery of unlisted clubs (search sweeps + link snowballing); matcher v3 fuzzy on distinctive words | `docs/decisions/0025-web-discovery.md` |
| 0026 | Press mentions (link/headline only, names redacted), estimated categories, recruiting-season pattern, wider LLM pages, Harvard-hosted club sites | `docs/decisions/0026-depth-pass.md` |
| 0027 | Application-form descriptions, sitemap hints, WordPress publication search, community submission import/review | `docs/decisions/0027-forms-sitemaps-publications-submissions.md` |
| 0028 | Plain facts in the UI (no per-value badges; sources collapsed), all non-rejected links shown as icons; paid search capped, batched, replayed and skipped when already done | `docs/decisions/0028-plain-facts-ui-and-search-credit.md` |
| 0029 | Automatic refresh (launchd), recruiting-season rechecks, logos from club sites, grounded one-line summaries | `docs/decisions/0029-refresh-logos-summaries.md` |
| 0030 | SOCO directory imported from the owner's hand-saved copy (never fetched; names, categories, flags; no officer names) | `docs/decisions/0030-soco-directory-owner-copy.md` |
| 0031 | Targeted recruiting pass (scored joining/recruiting links, linked forms, capped search fallback, page classification), stricter date/term rules, recruiting quality audit | `docs/decisions/0031-recruiting-pass.md` |
| 0032 | Completeness tiers (rich/partial/sparse/name-only) from public facts; name-only campaign with recheck, duplicate/rename detection, buckets, free-then-paid evidence and a review report | `docs/decisions/0032-name-only-campaign.md` |
| 0033 | Data-quality audit: pure checks over the whole DB, high-confidence fixes only (reject with reason / reversible merge); shared evidence rules for extractors and audit; resolver-v2 recency per staleness window | `docs/decisions/0033-data-quality-audit.md` |

---

## 25. Glossary

- **Club / organization** — any student organization in scope, recognized or not.
- **Comp** — Harvard term for a multi-week trial/competition process to join an organization (common for publications, some pre-professional and performing groups).
- **Source** — a logical URL/document; **Snapshot** — one immutable fetched version of it.
- **Mention** — an org reference found in a snapshot, before being linked to a club.
- **Claim** — an assertion of a field value about a subject in a temporal scope; **Evidence** — an observation supporting a claim.
- **Computed value** — deterministic calculation from claims. **Derived classification** — rule-based label.
- **Projection** — rebuildable read model the UI consumes.
- **Term key** — `YYYY-season`, e.g. `2026-fall`. **Recruiting cycle** — one club's recruiting instance in a term (and track).
- **Established official channel** — a source whose ownership by a club is evidenced (§7.1).
