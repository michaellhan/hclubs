# CLAUDE.md — hclubs

> Persistent engineering + product specification. **Read this file fully before doing any work in this repo.**
> If the code and this document disagree, stop and reconcile: either the code is wrong, or this document is stale and must be updated in the same change.
> Long autonomous sessions follow §26 (product goal, priorities, work loop) and keep `.claude/autonomous-backlog.md` current.

Status: **M2 complete** (discovery + enrichment system: 13 source adapters, candidate/entity resolution with reversible merges, link verification, shallow crawler, deterministic + optional LLM extraction, recruiting board, dev review UI). **M3 in progress** (website finder, web discovery of unlisted clubs, curated list, LLM on directory pages, browser fallback); see §22. Implementation docs: `docs/architecture.md`, `docs/data-model.md`, `docs/deployment.md`, `docs/sources/`, `docs/decisions/`.

Public name: **hclubs**, served at **https://hclubs.app/** (GitHub Pages custom domain on the public `michaellhan/hclubs-site` repo). The owner renamed it from "Harvard Club Index" on 2026-09-30 (ADR 0021, second amendment); the brand contains no Harvard mark. Internal package names (`@hci/*`, `pnpm hci`) are unchanged.

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
26. Autonomous product development

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

> Owner override (2026-10-03, ADR 0046): the directory's default order is now **Popularity** (Instagram follower count, a public proxy for how well known a club is). That is the one exception to "no prestige ranking"; counts only sort and are never displayed, and no other surface ranks clubs by it.

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
- `club` — identity: `id`, `slug` (unique), `canonical_name`, `record_state` (`active` | `merged` | `hidden`), `data_origin` (`ingested` | `fixture` | `editorial`), `merged_into_club_id` (check: set iff merged), timestamps. **As implemented (ADR 0014)** `club` also carries the resolver-written projection columns (`acronym`, descriptions, statuses, `join_modes`, `freshmen_eligible`, hours/member ranges, `fields` JSONB provenance, completeness, …) instead of a separate `club_profile` table. `joining` (ADR 0041) holds the derived joining facts: general vs role-only processes, access, comp, first-years, dues and no-experience-needed (ADR 0042) as yes/no/unknown, each with its basis. `join_modes` (general members only) and `freshmen_eligible` are written from it. Canonical name/slug are chosen by resolver or editor; history via claims + `club_slug_history` (old slugs redirect).
- `club_slug_history` — `slug` (unique), `club_id`, `retired_at`.

**Sources & snapshots**
- `source` — a logical document/endpoint: `id`, `url` (normalized), `url_hash` (unique), `domain`, `source_type` (enum, §7.1), `trust_tier` (1–9, §7.1), `owner_club_id` (nullable; set when the source is established as a club's own channel), `title`, `discovered_via` (adapter + run), `recheck_policy`, `robots_allowed` (last check), `active`.
- `source_snapshot` — immutable: `id`, `source_id`, `fetched_at`, `final_url`, `http_status`, `content_type`, `content_sha256`, `byte_size`, `storage_key` (object storage path), `text_sha256` (of extracted text), `fetch_method` (`static` | `browser` | `api` | `manual_upload` | `user_submitted`), `ingestion_run_id`. Unique `(source_id, content_sha256)` — an identical re-fetch does **not** create a new snapshot; it updates `fetch_attempt`.
- `fetch_attempt` — every fetch try: `source_id`, `run_id`, `started_at`, `status`, `error_class`, `retry_count`, `http_status`, `etag`, `last_modified`, `snapshot_id` (nullable).
- `image_probe` — one measurement per logo candidate image URL (size, format, pixel stats, `measure_version`), so the logos stage judges images without refetching (ADR 0049). Not a claim.
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
- **As implemented (ADR 0035):** `student_submission` (+ `submission_proposal`, one row per proposed field value) and `comp_report` (no user link; display off). `app_user`, `club_manager_role` and `staleness_vote` wait for M5.

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

The registry drives: DB validation in code, extractor output schemas, resolver behavior, UI rendering and filters.

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
3. Apply the field's resolution strategy (priority/recency with tier and `last_observed_at`), tie-break by confidence, then by claim id (stable). For recency-first fields an undated claim's observation time counts only per staleness window (resolver-v2, ADR 0033): a re-crawled lower-tier page never outranks a fresh official one just by being fetched later. Member counts rank the club's own channels (tiers 2–5) above other tiers within a window (`ownSourceFirst`, resolver-v7, ADR 0044 amendment). A source's excerpt-like short description (over 200 characters, cut off with "[…]", shouted, or an event pitch) gives way to its first sentence that describes the club, verbatim (`oneLineDescription`, resolver-v11); a description's first sentence also counts as a one-liner when it says what a group performs, combines, celebrates or was founded to do (resolver-v12). A club's name comes from the merge survivor's own claims when it has any; names of clubs merged into it count only as a fallback and otherwise become aliases (`survivorFirst`, resolver-v9, ADR 0019 amendment). Values that say the same thing in different shapes don't conflict: a registry `conflictKey` gives what a value asserts (dues: none / dues / amount), and a value that asserts nothing conflicts with nothing (resolver-v13, ADR 0051 amendment). A value's sources keep one quote per page, an editor-read one before a newer extractor span of the same page (resolver-v16). Event announcements ("Excited to welcome…", "will take place", "registration is now open", "Come to our…") are never one-liners (resolver-v17). Activities fold repeated lines (same label before a colon, a line mostly inside a fuller one, lines one generic noun apart) (resolver-v18). A short description cut off with "..." is an excerpt too, and an over-long one with no describing sentence gives way to a competing same-or-better-tier source's one-liner, verbatim (`oneLineFromResolved`, resolver-v14, ADR 0038 amendment); a section heading an excerpt glued to that sentence ("About Us Founded in 2016, …") is dropped (resolver-v15). A closing call to action ("Join us…", "Come join…", "Sign up…", "Follow us…") is never part of a one-liner: the text gives its describing sentence, or else itself without the invitation; a single describing sentence over 220 characters is cut, verbatim, at its last clause break (", cultivating …", ", which …", a dash or semicolon) that still says what the club is, never inside a list or an open bracket, and only when no competing source has a whole one-liner (`describingClause`, resolver-v19). A text that starts mid-sentence (a lowercase word other than a mixed-case name like "iGEM", or a bracket: "which performs in…", "founded in the 1960s.") is never a one-liner, even as the last resort, and Wikipedia's editorial marks ("[1]", "[citation needed]", "[when?]") are removed from one-liners and the shown long description (`startsMidSentence`, `withoutEditorialMarks`, resolver-v20, ADR 0038 amendment; wikipedia-harvard-orgs 1.2.0 stores whole list entries, never their tails). Our club-sport template one-liner ("Harvard club sports team for X.") gives way to the club's own whole describing sentence when one qualifies (`chooseOneLine`, resolver-v21, ADR 0038 amendment). Two short activity lists of the same event kinds one word apart fold ("Workshops, talks, and socials" / "Workshops and faculty talks", resolver-v22, ADR 0033 amendment).
4. Emit display value + chosen claim + `badge` + `conflict: true` if a competing claim of comparable tier/recency disagrees.
5. `multi` fields: union of sufficiently-established claims, deduped by normalized value.

### 7.4 Display badges (single vocabulary everywhere)

> **Owner decision (ADR 0028, amended by ADR 0036):** the public UI shows no badges or freshness text on values. Facts display plainly and don't open to anything (owner, 2026-10-05: no per-fact source boxes); provenance lives in each profile's one collapsed "Sources" section and /about. The vocabulary below is kept for the data model and internal tools.

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
- **Auto-link** only on a strong identifier: same Harvard directory ID, same established official domain, or same established social handle — and no contradicting strong identifier. A host several groups share, each club's site one folder on it (`pathScopedRoot`: hastypudding.org/hasty-pudding-club beside /hasty-pudding-theatricals), is not one unless both clubs sit in the same folder, nor is a social handle either club has only from that host's pages or nav/footer links; such pairs go to review (matcher-v4, ADR 0019 amendment).
- **High-similarity name match without a strong identifier** ⇒ `club_merge_candidate` / `pending` mention for human review. Never auto-merge on name similarity alone.
- **New club** only when no candidate exceeds the review threshold.
- Merge: loser `record_state = merged`, `merged_into_club_id` set, slug redirects. Claims keep their original `subject_id`; the resolver follows the merge chain. A merge never renames the survivor: its own name claims win over the absorbed club's, whose names stay as aliases (resolver-v9). This makes **splits** reversible without rewriting history.
- Supported states: duplicate candidate → proposed merge → confirmed merge; alias; split.

All thresholds and the matcher are versioned; resolution decisions record the version and signals.

---

## 13. Search & filtering

- Search: PostgreSQL full-text (`tsvector`, weighted: name/acronym/aliases A, categories/tags B, short description C, long description D) + `pg_trgm` similarity for fuzzy/typo/acronym matches + `unaccent`. Materialized in `club_search_document` with GIN indexes.
- Ranking: exact acronym/alias match ≫ name prefix ≫ FTS rank ≫ trigram similarity; demote inactive/merged/hidden.
- All search goes through a `SearchProvider` interface so Typesense/Meilisearch can be added later **only if measured necessary**.
- **Ranking amendments (ADR 0037):** abbreviation-only full-form name matches, ranked related words, a corroborated-description bonus that stands in for a missing category, first-letter-preserving typo correction; similar clubs need a signal beyond one shared category.
- **Topic intents (2026-10-12):** `perform` (music, a cappella, dance, theater) and `finance-consulting` (finance, consulting, quant, investing) merge thin intents for the directory's topic chips; `facetCounts().intents` leaves a topic no club in the view matches out of the Topic menu. The intent rule note was removed (2026-10-12): a topic shows only its name.
- **Discovery (ADR 0034):** the static site's search is richer than Postgres: a concept/synonym table (`@hci/db/local/concepts.ts`), typo correction against the index vocabulary, tiered field weights, and match reasons. "What do you want to do?" intents (`intents.ts`, `do=` param), the `open=1` "no comp or application" filter, home-page presets (hidden below 10 clubs) and deterministic "similar clubs" (`similar.ts`). Parity tests pin only filters and the exact name/acronym-first rule.
- **Instant client-side filtering:** for the directory page we may ship a compact precomputed index (id, slug, name, acronym, aliases, categories, filter attributes) when it stays small (target < ~300 KB gzipped) so filtering/sorting feels instant, QViewer-style. Postgres remains the canonical query path (and the fallback).
- Filters (all driven by registry fields): category/subcategory, join mode (open / application / comp / audition / tryout / invite-only), currently recruiting, deadline window, recruiting term, freshmen eligible, hours/week range, membership size bucket, selectivity (derived; "Unknown" is a filterable bucket, never silently excluded), recognition status, activity status, dues (none / some / unknown), affiliation scope.
- Filter state lives in the URL (shareable, back-button friendly).
- **Query reading (ADR 0034 amendment):** constraint phrases map to the yes/no/unknown filters and are returned as `constraints`; soft words (beginner, casual, low commitment) re-rank via `soft`; a phrase that is part of a club's name is never parsed. `suggest()` serves name typeahead. Round 3: distinctive name-word prefixes ("kroks"), weak description-only stems dropped under a constraint with a `relaxed` hint, hours phrases → `maxHours` (`hours=N`), social words → the Meet-people rule.
- **Round 4 (2026-10-04, from student testing):** concept `forms` (synonym spellings such as latino/latina/latinx/hispanic or south asian/desi, scored slightly below the typed word) and `otherSense` (another sense of a term, e.g. "indian" in Native American names, ranks last); process words (comp, application, apply, audition, tryout, deadline) are lifts toward clubs with that process or a live round, never required text, and select those clubs when typed alone ("no comp" keeps its filter); hours ranges ("3-5 hours a week", "3 to 5", "under 3-5 hours") set maxHours to the top; floors ("at least", "10+") never become caps. `senseTerms` limit the other-sense demotion to the ambiguous typed word; `SHORTHANDS` read comp lit/gov/bio/neuro as subjects, not comps; "due" is a deadline word and "this week"/"next week" beside it are a window; process-only queries select the same clubs in Postgres (`processPredicate`). Natural queries: a name word that only restates the club's umbrella category ("Technology" at a Technology & Engineering club) adds nothing; a concept counts once per club; the Meet-people lift breaks ties rather than outranking description matches.
- **Search while typing (2026-10-04):** the directory searches on every keystroke, so the last word is read as half-typed: it matches any name word it begins from one letter ("c" → Crimson), filler words ("harvard", "club", "group") only from three letters or after other words ("consulting g"), acronyms and initials it begins ("hc" → HCS, "io" → IOP when no name word starts "io"), and a name whose core without "The Harvard College" begins with it. One- and two-letter words never match descriptions. A half-typed word that begins at most two topics' terms reads as them at 0.6 weight ("dan" → dance), never when it begins a filler word ("har"). A finished topic word reaches compound names ("data" → Datamatch), never a longer different word ("math" ≠ Mather). Initials also keep "of" (Institute of Politics → IOP). Equal relevance scores break by stated Instagram followers, then name (`followersCompare`); `suggest()` does the same and starts at one letter (core names only). An acronym the word begins outranks a name word it begins ("pb": PBHA before "PBHA's …" programs). A lone process word also selects clubs whose name core begins with a longer word from it ("comp" → Computer Society, never Ballet Company; `processNameStarts`, Postgres `processNamePredicate`), just below clubs that have that process (Round 9: the Crimson and the Advocate before the Computer Society). "kpop" is its own concept (`relatedInCategory`: related words count only at Dance clubs), since no club's own page says it dances K-pop. Acronyms can be editor-read facts (`club.acronym` in `curated/facts.ts`; the quote must contain it as a word, same case): IOP, PBHA.
- **Round 5 (2026-10-05, ~230-query sweep):** new concepts where clubs existed but no word reached them (psychology, neuroscience, martial arts, Iranian/Persian, sci-fi & fantasy, classics, international relations, international students, student government, pre-vet; fraternities/sororities incl. renamed chapters; instruments as music; a cappella counts as music). `clubNames` points a concept at whole club names ("student government" → Harvard Undergraduate Association, never "… Association of Ghanaian Students"). The typed phrase in a name (14) outranks a related name word + category + related text; a multi-word topic's own words rank first among its related words ("rock climbing" → Climbing Club); a phrase also matches written as one word ("board games" → Boardgame) and an unknown word that splits into two name words is read as both ("standup", `splitCompound`). Parts of a query found only in a club's activity list, or only through a related word, and never side by side (any word form) don't match ("law school" at a moot court). Whole-query bonuses use the corrected spelling ("crimsom"); "Harvard X" counts as named X; partly typed multi-word topics complete ("student gov", `phraseCompletion`); filler words complete after any typed word ("undergraduate ass"). "dont need applications" → Open membership; "open now" → Recruiting now; "help"/"pickup" are filler. Partial-match fallback never rests on a 1–2 letter fragment or a typo guess.
- **Round 6 (2026-10-05, every club typed by name):** a sweep types each club's full name, its name without "Harvard", half of it, its acronym and a swapped-letter typo; all full names and acronyms rank #1. Fixes: between equally close spelling fixes, the one with the same letters wins ("pateint" → patient, "chours" → chorus); a rare name word that begins a much commoner one 3+ letters longer is still half-typed ("student inter" → International); a filler word typed last that begins a name word lifts it without being required ("women in for" → Foreign Policy); "dont audition", "unauditioned" read as the beginner modifier, "free clubs" as No dues. The search box's suggestion list (`typeahead-list.tsx`) and `suggest` load on first use, never on the directory, which had shipped its row pills and labels twice (236 → 227 KB gzipped up front).
- **Round 7 (2026-10-05, category and topic sweeps):** a multi-word category name typed whole ("technology & engineering", "social and community", optional "Harvard"/"clubs") matches every club in it, +20 (`categoryNamed`; one-word names stay with their concepts so soft words still rank, "dance beginner"). New concepts: crypto & blockchain, riding (polo), lifting, meditation, Jewish life (Hillel), dating (Datamatch via `clubNames`), rights & justice (Advocacy & Justice), photography, astronomy, biology, food & cooking, design; more terms (fintech, ecology/nature, breakdance, songwriting/composing/rap/dj, voting, cards, drones, hacking). A related word with the typed word's stem counts as the typed word ("composing" → Composers, "voting" → Votes Challenge) and ranks first. A bare description mention by a club outside the concept's categories is 4, a one-word activity-list mention 4, both below the category's own clubs (5); the typed word in another spelling never adds a related-word bonus ("theatre" for "theater").
- **Round 8 (2026-10-12, live student testing):** question and helper words (`QUESTION_WORDS`/`STOP_WORDS` in `constraints.ts`: what, when, how, is, are, still, i, can…) are filler: never spelling-corrected ("what" ≠ "wha", "still" ≠ "skill"), never required, stripped from the searched text ("what is punching" → punching; "what's a comp" selects comp clubs); a 2+-word query of only them with a question word or "join" ("how do i join", "clubs to join") is the browse list. "join now", "still join", "still open", "join this semester", "join anytime" → Still time to join (`stillTime` constraint; "join anytime" was Open membership). "recruiting"/"open now" when no club in the default directory has a round open (`anyRecruitingNow`) read as Still time to join with `instead: "recruitingNow"`, and the note says so. Season words ("finance spring", "spring recruiting", "recruits in the fall", "rolling basis") → the existing `season=` filter (`recruitingSeason` constraint; unknown ≠ match, relaxed hint when few), never when the word begins a club's name phrase ("spring break"). Static-site only, like intents (Postgres applies the season, not `stillTime`).
- **Initials (2026-10-05):** a hyphenated name word counts as one initial ("World Pre-Health Conference" → WPC, also WPHC); core initials also keep short words ("Women in Business" → WIB) and drop just "Harvard" ("Undergraduate Venture Capital Group" → UVCG). Search and `suggest()` share `clubInitials`.
- **Round 9 (2026-10-12, live testing):** identity concepts (`identity`, `people`; + Black & African diaspora, East Asian, Asian American, Muslim): broad Cultural & identity groups +3 over career ones; "black" only in the identity sense (`notSense`, `notInActivities`). Audience clubs (`clubAudiences`: women/men, a community, a faith in the name or one-liner; a voice part such as "male a cappella" is not one) follow general clubs (−1) on a topic that doesn't name the audience, their name counting no more than their other evidence; not in /match. Venues/labels aren't topics (Sanders Theatre, "theater dance"); dance ignores activity lists; a non-term related name word outside the category stands in for it (Ghungroo); sparse clubs −0.5. "or" (or "and"/comma between topics) is a union, all matched +20; "no audition" puts auditioning clubs last; one-letter-off topic phrases are corrected ("a capela"); start up, cross country, running (sports text only). Similar clubs: shared identity +6 (+4 if only mentioned), K-pop's "asian" only at Dance clubs, governance bodies only beside each other. Intents: fund phrases, no paid ensembles or umbrella-only event committees in Perform.
- **Round 10 (2026-10-12, student testing round 3):** English function words and contractions (that, this, much, dont, need, want, take…; `STOP_WORDS`) are never spelling-corrected or required ("that" had become "thai", "much" "mich"), and in a question "time"/"long"/"hours" are filler ("how much time does the crimson take" → crimson). Negated asks are filters (`negatedAsks`): "dont need experience" → No experience needed, "dont require (an) application(s)"/"dont have to apply" → Open membership, "i dont want to comp" → No comp; "this semester/term" → Still time to join. Identity: Middle Eastern & North African (`mena`) and African concepts; a people word in a name stands in for the category (`identityNameStandIn` 4); "<demonym> American" is the demonym's groups, then `Concept.diaspora` at 0.6 ("korean american" → Korean, then Asian American). `inCategoryText`: theat*/play/drama words count in text only inside Theater ("breaking"/"popping" inside Dance); "theatricals" shares "theater"'s stem; public-service programs follow on non-service topics (−6, `serviceProgramAside`); in-category activity-list word + two related words in the one-liner counts like a description; the word in the one-liner's self-description ("hip-hop dance group") +0.5. "start/found/build/launch a company/business/startup" are startups terms. An audience club's name counts in full unless the name itself marks the audience (incl. "BlackCAST") or only repeats its category ("ApiChorus A Cappella"): Ballet Folklórico #2 for "ballet". K-pop `namesAnywhere` (Korean groups after AADT, before other dance). "dont audition": clubs saying so +6, performing groups +4 (tryouts: sports). Under a constraint, activity-list-only matches are passing mentions (`passingUnder`, facets too); the No comp relax hint lists no-cut comps (`noCuts`). A typed season orders dated rounds (+10) and announced rounds (+8) in it first; the season filter follows an announced later round over the pattern (static only; Pitches' Fall 2027 isn't spring, HCDU's Spring 2027 is). "Community" in a name doesn't stand in for meeting people. Finance & consulting picks "business", "economics", "federal reserve" from names (`Intent.nameWords`; not arts/sports). /match: an instrument or other topic word that names ≤3 clubs is its own interest (Piano Society first); hospital/patient/clinic → pre-med. Similar clubs: a graduate-school-named club with unknown scope −3 (`graduateNamed`).
- **Round 11 (2026-10-13, student testing round 4):** selectivity asked in words ("selective", "exclusive", "prestigious", "hard to get into", "acceptance rate", "competitive" as a modifier: "competitive clubs", "most competitive" or a query ending in it, never "competitive dance") is a process lift like "apply" toward clubs with an application, comp, audition, tryout or invitation for general members (`SELECTIVE_MODIFIER`, `SELECTIVE_JOIN_MODES`, every mode equal), selects them alone (Postgres `processPredicate`), ties go by name, never followers (no prestige ranking, §9), and the result carries one note (`notes`: "Clubs with a selection step. We don't know how hard any is to get into."); "least/less selective", "not competitive", "easy to get in" → Open membership; "least", "rate", "into" are function words. "transfer(s)", "transfer student(s)", "sophomore transfer" are soft beginner words; alone they read as Still time to join (`SoftModifier.alone`); "mid semester", "mid year", "join late", a bare "late" → Still time. The stem rule folds -ic/-ics/-ical ("politics" = "political": the Democrats and HPU join HPR and IOP on top). Concepts: writing takes op-ed/opinion/column (not "public opinion" polling) and `Concept.kinds` (a one-liner saying "student newspaper" or "weekly print issues", +7 without a name match: the Crimson and the Independent lead "journalism"/"newspaper"); hospital & clinical volunteering (`clinical`, text only at health/service clubs, activity-list words count: `activitiesCount`); emergency medicine (`clubNames`: "emt" → CrimsonEMS); social impact consulting with a required consulting half (`alsoNeeds`) and nonprofits & social impact on their own (out of Public service); hunger apart from food & cooking (`notSense` food security/drives); video games & esports apart from games (no chess or poker); outdoors words count in text only at sports and hobby clubs (no camping-trip mentions). A one-word topic's multi-word term in the name of a club outside a category-less concept stands in a little (+3.25, `conceptPhraseNameStandIn`: Mock Trial and Moot Court before Model UN conferences for "debate"; not for a typed phrase or an abbreviation such as "mun"). A leading "men's/women's/co-ed" is left out of the core name ("tennis": Men's and Women's Tennis before Table Tennis). A one-liner opening "volunteers … teaching" follows on non-service topics like a service program (Baking Club before Food Lab for "cooking"). A hidden club found by a few words of its name (graduate, ended; `mostOfName` ≤ half its distinctive words) follows every club shown by default ("public health"). Soft words: "drop in" no longer answers casual/low commitment; stated hours outrank a comp for "low commitment"; a comp with cuts counts as a tryout for "no tryouts", whose note talks about auditions and tryouts, not hours. Topics: Sports leaves out non-club-sport groups also filed under a career field or the performing arts (`notPlaying`: Sports Lab, An Evening with Champions); Get outdoors needs a sports or hobby category; new `games-hobbies` ("Games & hobbies": Hobbies & Games plus game words). Similar clubs: "sport(s)" and men's/women's aren't shared words, and two clubs both named for a topic +2 (`namedConcept`: Climbing → Mountaineering, Outing, Ski; not every club sport).
- **Round 12 (2026-10-13, student testing round 5):** class years ("sophomore(s)", "junior(s)", "senior(s)", "upperclassmen", "second/third/fourth years") are soft `classYear` words like "for freshmen": never required or corrected, a lift toward clubs stating they take that year (`SoftModifier.classes`; a stated list without it follows), alone Still time to join. The empty state says "check the spelling" only when a word is unknown (`unknownWords`). A club filed under a topic's own category whose word is only in its activity list matches by the category, so it answers a season or other constraint (HDAG for "consulting spring"; not umbrella categories); a bare description mention outside the category, in a list of what the club does, is a passing mention under a constraint (the Conferences Committee's "finances"). "case interview(s)", "case prep", "case competition(s)" are consulting. Orchestra & strings is its own concept (orchestra, symphony, violin, viola, cello, strings…; text only at Music clubs; `widerCategory`: found only through Music, a club gets soft lifts slightly), so "violin" leads with orchestras, not "Music" in a business club's name. "No audition(s)" puts clubs that audition last (`last`), whatever their name match. Stems keep three letters ("sing" reads "Singers"/"singing" as the word); singing's terms in a name stand in for its category (`termNamesStandIn`: Chorus, Choral Society). Stated hours alone lift a club found only through a category slightly ("volunteer low commitment"). Topics: "Startups & VC" (`explore-startups`, + venture/VC names) in the Topic menu; Volunteer orders service programs, clubs saying volunteer/tutoring/mentoring/service, then clubs filed first under Public Service, before secondary-category clubs (`volunteerRank`). Similar clubs: a parent and its programs (acronym in the name, "PBHA's …", or the parent's whole name first) +6, "A PBHA program". /match: Orchestra & strings is an interest; clubs for a community or faith the resume never names ×0.6. Selectivity ("selective finance clubs") is unchanged: the index has no self-described selectivity or stated acceptance rates. Build budget: the relevance model, concepts, facets, relaxations and similar clubs load beside the index (`apps/web/src/lib/search-engine.ts`); the light helpers rows and chips need (`cleanQuery`, `liveClub`, `reasonText`, `constraintPatch`, `CAREER_CATEGORIES`) live in `local/basics.ts` (/clubs 242.7 → 216.8 KB gzipped JS up front; every page lost ~30 KB, since the 404 boundary's "Were you looking for" had pulled search into all of them).
- **Popularity sort (ADR 0046):** `popularity` is a sort key (`popularityCompare` in `@hci/db/local/search.ts`, Postgres parity in `SearchProvider`). Clubs with a stated `club.instagram_followers` count come first, highest first (ties by name); clubs without one follow in the Suggested order. A count last read more than 90 days ago is unknown (registry `maxAgeDays`, resolver-v10), so stale counts stop ranking; refresh.sh re-reads up to 110 profiles on the first Sunday of each month. It is the default when there is no search text; with text, relevance still wins. The count is never displayed.
- **Joining filters (ADR 0041)** read the derived `joining` facts, never the absence of a claim. They are Open membership (`open=1`), No comp (`nocomp=1`), No dues (`nodues=1`) and No experience needed (`noexp=1`, ADR 0042; confirmed-only, never "no"). **Still time to join** (`later=1`, `matchesStillTime`, owner 2026-10-12): a round open or upcoming within this academic year, open membership, rolling recruiting, or from August to December a club whose past rounds were in spring; a round the club announces for a later term replaces the pattern and counts only within this academic year (ADR 0051 amendment); the quick row shows it instead of Recruiting now unless at least 5 clubs directory-wide have a live round (`RECRUITING_WINDOW`). Static-site only, like intents. First-years eligible was retired as a filter (owner, 2026-10-12): 71 of 692 clubs said either way and almost every club takes first-years, so it hid ~90% of clubs that would have them. Old `freshmen=1` links open unfiltered; "for freshmen" in a query is a soft beginner lift; the fact still shows on profiles when stated. Unknown is in neither bucket. Facet counts carry yes/no/unknown (in the filter tooltips); under the results the directory says only, quietly, that the list is clubs that say so. Sourcing and methodology live in the profile's Sources section and /about, not in the browse flow. "Selection process" lists processes for general members only.

---

## 14. Community contributions & comp outcome reports

Build later; schema must not make them painful.

**Contribution types:** suggest an edit, submit updated link, submit recruiting deadline, report inactive club, vote data outdated, claim/manage a club page, anonymous comp outcome, anonymous approximate applicant count / cohort size.

- `student_submission` — `id`, `kind`, `subject_type`, `subject_id`, `payload` jsonb (Zod schema per kind), `evidence_url` (optional), `submitter_ref` (nullable, opaque), `status` (`pending` | `accepted` | `partially_accepted` | `rejected` | `spam`), `reviewed_by`, `reviewed_at`, `resulting_claim_ids[]`. Accepted submissions become claims with `source_type = student_submission` (tier 9) or, if they include a verifiable official URL, trigger a fetch of that URL so the fact is backed by a real snapshot.
- **As built (ADR 0035):**
  - **Links.** Profiles link to the Google Form prefilled with the club, the kind of update and a `Label: value` answer template.
  - **Import.** Each answered line becomes a `submission_proposal` that is accepted or rejected on its own (`partially_accepted`).
  - **Claims.** An accepted field is a `user_reported` claim evidenced by the submission, never by the submitter's URL. The URL is fetched like any source; only a page that states the value adds a second, `stated` claim at that page's tier.
  - **Conflicts.** A community value never silently replaces a sourced one: the reviewer must `--override`.
  - **Personal data.** Email addresses and phone numbers are stripped on import.
- Club managers (`club_manager_role`, verified via an official club email or editorial check) submit claims as `club_recruiting_material`-equivalent tier with `editorial` provenance — still claims, still auditable.
- Auth (when built): Harvard email verification (magic link). No passwords stored.
- Anti-abuse: rate limits, moderation queue, per-user caps, anomaly checks.

**Comp outcome reports** (`comp_report`): club, recruiting cycle, class year (coarsened), applied, furthest stage reached, accepted, approx applicants known (optional), approx cohort size known (optional), perceived hours spent, optional notes (moderated before any display; never displayed verbatim by default).
- **No foreign key from `comp_report` to a user.** Dedupe/rate limiting uses a separate table with a keyed hash (HMAC with a server secret) of the verified identity per cycle — not reversible without the secret, rotated per cycle.
- Aggregates are shown only when `n ≥ k` (start `k = 5`) per cycle, and with coarsening such that no individual outcome can be inferred (e.g. do not show "1 of 5 accepted" breakdowns by class year).
- Never expose PII. Never display individual reports.
- **Implemented (ADR 0035), display off:**
  - **Storage.** The `comp_report` table, plus `recordCompReport` / `compAggregateFor` in `@hci/db`.
  - **Aggregation.** `aggregateCompReports` in `@hci/core` (`comp-agg-v1`): nothing below 5 reports; the admitted share needs 10 reports and at least 3 on each side, shown as a 10-point band "of reporters"; small stage groups are hidden; no class-year breakdown; always labelled community and kept separate from club-published numbers.

---

## 15. UI requirements

Routes (Next.js App Router):
- `/` — minimal (owner, 2026-10-03): headline, search box, and two links: `JoinNowLink` ("N clubs recruiting now" when a round is open on the reader's day, else "Browse N clubs", the directory's default view) and "Find clubs from your resume" (/match). Owner, 2026-10-05: the "Clubs you can join anytime" fallback is gone (29 of 692 clubs, because most never say how to join). No example-search line (owner, 2026-10-04). No category list (owner, 2026-10-03; categories stay on profiles and the directory). Joining filters and intents live in the directory (header nav).
- `/clubs` — search, filters, sorting, dense list (default) + card view toggle, infinite scroll or pagination, responsive.
- `/clubs/[slug]` — name, acronym, logo, badges, description, categories/tags, official links, **How to join** (join mode, current cycle, deadlines, stages), time commitment, membership, eligibility, selectivity evidence, activities/projects, data freshness, **Sources** panel (every claim → source, observed date, badge), "Suggest a correction." The top answers the five-second questions in order (owner, 2026-10-03): what it is (one-line description), then a key-facts strip (`KeyFacts`: **How to join** with a one-line gloss of comp, audition or tryout for first-years (`processGloss`: "Comp: a few weeks of doing the club's work to join"; process type says nothing about cuts, §9) and first-years/no-experience (no "Per the College directory" subline), **When** via `joinTiming` recomputed on the reader's day, **Time commitment**, only the ones that are known, as plain text; owner, 2026-10-04: no "Unknown" cells or inline form links), then the Apply/website/Instagram buttons (the featured link reads "How to join", not "How to apply", when no application or comp is on record; "Check how to apply at <site>" goes to the site's newest comp/join page we read, `pickJoinPage`; a club's twin domains' identical labelled links collapse in More links; seasons alone never open the How to join row; a name-only line shows only when no joining fact is known; an announced next round joins a closed one in compare's summary). With nothing better, When names the club's last evidenced round of the past year ("Last comp: Spring 2026", `lastPastRound`, history only: never a season pattern), also on rows and compare; a round with only the bare process ("Comp", undated) shows no round block (`isBareRound`); a round the club says closed with no date reads "Fall 2026 applications closed"; an open club whose one process cuts no one reads "Open membership (audition, no cuts)" (joining-v5); compare's summary starts with "Can join now: …" (ADR 0051 amendment, 2026-10-13). On phones the compare tray says "N clubs" with wrapped names, its clear needs a second tap, and the page ends above it. A hosted form whose label or title names a round already over (an earlier term, or the current term after its first month: "Fall 2026 … Interest Form" from Oct 1) is never featured unless it is the current round's own link; the club's comp/join page or "Check how to apply at …" takes its place, and the form stays under More links as "Fall 2026 round" (`pickLinkBar(…, now)`, `applyLinkText`; ADR 0051 amendment, 2026-10-12). When nothing else says how to join (no process, no open-membership fact, no apply link) and the club has a mailing-list sign-up link, a quiet "Join mailing list" button takes the place of the vaguer "Check …" link; it is a link to the list, not a membership claim. A form for a closed round never sits in the icon bar (it moves to More links). Logo http addresses are upgraded to https. (Owner, 2026-10-12: the "Ask the club" / "Ask how to join" chip, its email/DM panel, localStorage memory and GoatCounter event were removed.) "Details" is a collapsed row with only the remaining known facts; nothing unknown is listed anywhere on the profile. Minimal layout (owner, 2026-10-03): one centered column (no sidebar); header pills only for warnings (ended, dormant, non-College scope), categories as a quiet text line; visible below the header are only About and Similar clubs (4). About leaves out sentences the one-liner already says and is hidden when it mostly restates it (`lib/about-dupe.ts`). Everything else is a collapsed row (`profile/disclosure.tsx`): How to join (process, rounds, stages), Details (recognition, size, dues…), What they do, Selectivity (only with numbers or the club's own words), In the news, More links, Sources. (Owner, 2026-10-04: "Other ways in", "Membership over time", tag chips and row counts removed.) A link to a row's id opens it (`OpenOnHash`). The page ends with one quiet line, "Suggest an update · I run this club" (`ImproveLine`, `#improve`), the profile's only form links. A name-only club gets one line saying so.
- `/compare?clubs=a,b,c` — side-by-side (2–4): category, org type, join mode, comp process, selectivity evidence, hours/week, member count, deadline, eligibility, major activities. Unknowns shown explicitly. The summary above the table uses the rows' next-chance wording (a round the club announced for a later term, `later`, outranks its usual seasons; no source is named, "X has no comp"), never repeats a pattern, and removing a club keeps the table (no skeleton) and offers Undo; the phone tray lists every picked name on one line.
- `/recruiting` — retired (owner, 2026-10-04, ADR 0048): most of the year it listed patterns, not rounds. The route is a noindex client redirect to `/clubs?recruiting=1` (keeps `category`, `join`, `class=first_year` → `freshmen=1`). The directory's empty "Recruiting now" state offers join-anytime clubs. The section builders (`buildBoardSections`, `buildNextChances`) still drive the profile's "Missed this deadline?" and compare's "Next chance" row.
- Directory: minimal (owner, 2026-10-03): one centered column, no sidebar. Search box, then one row (owner, 2026-10-12: "only keep crucial"): a Topic dropdown (`topic-menu.tsx`: Volunteer, Perform, Cultural & identity, Build software, Finance & consulting, Pre-med, Politics & policy, Write & report, Mentor & teach, Sports; each an intent), the quick chips Recruiting now or Still time to join and No comp (no counts) and a "More filters" button that opens every other filter (categories in two columns; Open membership, No dues and No experience needed under Joining) in a panel; the result count shares one line with a Copy-link icon button and a plain Sort menu (the compare tray hides while the filter panel is open and on /compare, /saved, /feedback and /for-clubs); an empty result emptied by a Joining filter says "No finance & consulting club is confirmed for No comp. Show all 22 (7 say no, 15 don't say)" (`unconfirmedHint`). Rows are borderless dividers: name, one-line description, a recruiting chip (a live round, or with none, `RowRecruiting`'s next-chance line from `rowNextText`: "Closed Sep 5 · next round likely in spring", the same `nextChanceShort` decision the profile's "Next:" line and compare use, so a club listed under Still time to join says why; nothing when unknown), up to two joining pills that never contradict (`joinPills`: a process outranks Open membership, "Audition, no cuts", open + attendance-based fold to one), hours if known, first category, and Save (no link icons, member counts or Compare on rows; those are on the profile). With no search the default order is "Popularity" (ADR 0046, owner decision, overriding ADR 0039's neutral default): clubs with a stated Instagram follower count first, most followers first, then every club without one in the "Suggested" order (`featuredCompare`): clubs recruiting now (soonest deadline first), then join-anytime clubs, then everyone else in a daily shuffle that is the same for all visitors that day. Follower counts only sort; never shown. Never by how much is known about a club (ADR 0039). The Sort menu offers Popularity and Name (plus Best match when searching); "Suggested" (owner, 2026-10-04) and "Soonest deadline" (owner, 2026-10-05) are no longer menu options and old `sort=featured`/`sort=deadline` links open in Popularity, but its order remains the tie-break for uncounted clubs. The list grows by 30 rows as the visitor scrolls (a "Show N more" button stays for keyboards); how far they got is kept for the tab in sessionStorage so Back from a profile shows the same rows, and old `page=N` links open with N×30 rows (owner, 2026-10-05: no Previous/Next pages). Other pages' search box offers name typeahead (`suggest()`).
- `/match` — clubs for your resume (ADR 0047): a PDF/text resume or pasted text is read in the browser only (pdf.js, never uploaded); its text and turned-off chips stay in localStorage (`hc-resume`) until Clear (owner, 2026-10-04); `readResumeInterests` + `matchResume` (`@hci/db/local/resume.ts`) turn its topics and club-name words into ranked clubs, with the interests shown as chips the student can turn off. Clubs for women or for men (name or one-liner, `clubAudience`) are suggested only when the resume itself says so (a women's/men's team or group, sorority/fraternity, pronouns; `resumeAudiences`). A "Match" tab in the header nav; also linked from the home page.
- `/saved` — the visitor's saved clubs (localStorage only, no account, never sent anywhere), most urgent first, with joining, the same next-chance line as the directory (no "No recruiting dates known" text), hours and Apply; compare up to 4 (one Compare control on a phone: the sticky bar once a club is ticked; the hint line above the list keeps its height so ticking never shifts the buttons; Undo on a removed club restores its tick; the summary says how many closed clubs state a usual season when not all do); `?clubs=a,b` share links offer an import. Old slugs follow their redirect.
- `/feedback` — one page for everything visitors tell us (owner, 2026-10-05: suggest and feedback merged), with an "About a club / About the site" switch. **A club** (`?club=<slug>&topic=<type>`, or opened from a profile via the footer's `?from=/clubs/<slug>`): every contribution topic (Add / Report groups), its template prompts as fields, asked as questions that don't repeat the topic (`promptQuestion`), plus an optional "Where is this posted?" link unless the answer is itself a link (`answerIsLink`), sent as importer-ready `Label: value` lines through the prefilled contribution form; every profile "Suggest an update" link opens it; the importer takes a `Where this is posted:` link as the evidence URL when the form's source question is empty (ADR 0035). **The site** (`?about=site`, the footer's Feedback link elsewhere): one box, sent as "Feedback about the site". `/suggest` is a noindex client redirect to `/feedback` keeping club and topic. `/feedback` and `/for-clubs` send from the page (`SendButton`, `lib/form-send.ts`: the prefill link's answers POSTed to the Google Form's `formResponse`, so visitors never see Google Forms and responses land in the same sheet). If the request fails, the prefilled form opens instead; with no form configured, they fall back to email.
- `/contribute` — clubs known only by name, each with a prefilled "Add info" form link (ADR 0030).
- `/for-clubs` — structured update form for club officers (`?club=<slug>` preselects; the profile's "I run this club" chip links here). Answers become importer-ready `Label: value` lines (`officerDetails`, browser-safe) sent through the existing contribution form; a person reviews each field (ADR 0045).
- `/categories/[slug]`, `/about` (owner 2026-10-05: what it is with the directory's own club count, not affiliated, feedback/contact, then a short "How it works" list with `#conflicts` and `#joining` anchors that replaced the methodology page; `#joining` also defines comp, punch, audition and tryout; both club counts are stated: all, and those the directory shows by default), `/about/bot` (crawler info + opt-out/takedown contact). `/about/methodology` and `/about/glossary` are noindex redirects to `/about`.

Rendering (ADR 0022): the site is a static export. Profile/category/about pages are prebuilt from the local DB; the directory, search, filters, compare and recruiting board run in the browser over `/data/index.json` via the pure `@hci/db/local` module (parity-tested against Postgres). Anything depending on "now" is recomputed client-side after mount (`useNow`). No server mutations until M5 brings a server back; corrections go by email/form.

Every dynamic field in the UI renders through `<FieldValue>` (plain value) or `<Fact>` (same plain value, marks key facts; owner 2026-10-05 removed the source boxes of ADR 0036), both in `components/provenance.tsx`. No ad-hoc rendering of claimable fields. Derived joining facts render through `<DerivedFact>` (plain; the rule is on /about#joining; ADR 0041). Unknown facts are left out rather than listed (owner, 2026-10-04, superseding ADR 0040's "Not known yet" line); a missing fact is never shown as a "no", and the closing line is the one way to add it. Profiles show all non-rejected links (including unverified social accounts) as an icon bar under the name.

---

## 16. Design direction

- Polished student-built product, not enterprise dashboard. Clean, fast, minimal, **information-dense**.
- Excellent typography (one sans family, tabular numerals for numbers), tight but readable spacing, strong hierarchy.
- Mobile-first; the directory and profile must be fully usable one-handed on a phone.
- Palette follows the coral **hc** logo: warm `stone` neutrals, coral `brand` fill (dark text on it, never white) for primary actions, coral `accent` for text, focus rings and highlights (tokens in `apps/web/src/app/globals.css`). Pills and buttons are fully rounded.
- Useful badges (join mode, recruiting now, first-years OK, freshness), not decorative ones.
- No native browser widgets in the UI: dropdowns use `SelectMenu` (`components/select-menu.tsx`), never `<select>`; checkboxes/radios and search inputs get the site look from `globals.css`; hints use `data-tip` (site tooltip), never `title`. Shared shapes: `hc-btn-primary` (primary button), `hc-chip` (outlined chip), `hc-list` (borderless list of clubs or links), `Chevron` / `ShowMoreSummary` (`components/ui.tsx`) for every disclosure; pages are one centered column (`max-w-2xl` forms and prose, `max-w-3xl` lists, `max-w-4xl` compare) with a `text-2xl` heading.
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
scripts/publish-pages.sh michaellhan/hclubs-site ""          # build + publish to hclubs.app via GitHub Pages (docs/deployment.md)
scripts/refresh.sh [--weekly] [--no-publish]         # crawl what's due, logos, LLM on changed pages ($1 cap), reconcile, republish (ADR 0029, 0049); --weekly on the first Sunday also re-reads Instagram follower counts (capped)
scripts/install-refresh.sh [--remove]                # launchd: daily 6:00 refresh, Sundays --weekly

pnpm ingest:discover        # all discovery adapters (official first); --source=a,b  --offline (test fixtures)  --stored (re-parse stored snapshots, no requests: after an adapter version bump)
pnpm ingest:find-sites      # find websites for clubs with none: guessed domains (+ --search via Brave API), page must name the club
                            #   --instagram: one site:instagram.com search per club; a match must name the club and say Harvard, and be the profile itself or a handle with the club's name (OR batches came back empty); --loose: unquoted second phrasing
pnpm hci reject-link <slug> <url> --reason="…"   # reject a wrong link on a club (audited, reversible via claim status); a website also releases its pages and rejects claims only they supported (ADR 0040)
pnpm hci reject-value <slug> <field> <json|text> --reason="…"   # reject every active claim of one value, e.g. a wrong category
pnpm hci restore-value <slug> <field> <json|text> --reason="…"   # undo reject-value (audited restore_claim decision)
pnpm hci discover-web --search --outlinks   # find clubs no directory lists: topic search sweeps + links on crawled pages (ADR 0025)
pnpm hci name-only [--search-budget=N] [--limit=N] [--dry-run]   # name-only campaign: duplicates, free evidence, capped search; data/reports/name-only-review.md (ADR 0032)
pnpm hci audit [--apply | --apply-only=check.a,check.b] [--check=links,content,…,invariants,joining] [--check-urls] [--fail-on=critical|high]   # data-quality audit: data/reports/audit.{json,md}; --apply fixes high-confidence findings only (ADR 0033, 0036, 0038)
pnpm hci explain <slug> [field…]   # every claim behind a club's fields, its evidence, and which one is shown (ADR 0036)
pnpm hci projection save|diff [--name=N]   # save what the site shows; list every displayed value that changed since: data/reports/projection-diff.md (ADR 0039)
pnpm hci resolve --diff      # re-resolve and list the displayed values it changed
pnpm hci recruiting-review   # every live deadline/opening/apply link with board section, source page, fetch date and quote: read before publishing
pnpm hci name-only --diagnose   # why each name-only club has no details, grouped, with the next action (no network)
pnpm hci lifecycle --candidates   # sentences on stored pages that say a club ended or was renamed (leads for curated/lifecycle.ts)
pnpm hci backup [--out=DIR] | restore <dir>   # logical DB backup (gzipped NDJSON per table + checksummed manifest); restore only into an empty migrated DB
pnpm hci snapshots verify    # every snapshot blob exists, decompresses and matches its hash
scripts/backup.sh [dest]     # DB backup + incremental snapshot copy (ADR 0039)
scripts/rollback-pages.sh michaellhan/hclubs-site   # re-publish the previous build (data/published/previous)
pnpm hci coverage            # field coverage overall and by category: data/reports/coverage.md
pnpm hci queue [--limit=N]   # missing facts most worth finding next, deadlines to confirm first (internal): data/reports/queue.md
pnpm hci snapshots search "<regex>" [--missing=<field>]   # grep crawled club pages (no network); e.g. --missing=club.hours_per_week (ADR 0037)
pnpm hci opportunities [--field=…]   # clubs showing Unknown whose own pages likely state the value: data/reports/opportunities.md (leads only)
pnpm --filter @hci/db exec tsx scripts/search-report.ts [query…]   # search ranking benchmark over the built index (diff two runs)
pnpm hci privacy-scan [dir]  # personal data in the built site (default apps/web/out); run after build, before publishing
pnpm hci audit-dismiss <slug> <check> [subject] --reason="…"        # keep data a finding questioned, after review (audited; the finding stops reappearing)
pnpm hci check-forms [--club=a,b] [--stale-days=7] [--dry-run]   # re-fetch every shown application form and page (one polite request each, no claims); then `audit --check=links --apply-only=application.form_closed,application.form_deleted,application.past_cycle` rejects closed, deleted and past-cycle ones (ADR 0051)
pnpm hci recruiting [--missing-only|--stale-only] [--search-budget=N] [--no-ai] [--budget=USD] [--dry-run|--audit-only]   # targeted recruiting pass + quality audit (ADR 0031, docs/recruiting.md)
pnpm hci instagram-login     # opens Chrome with the saved profile for the owner to sign in to Instagram by hand (ADR 0050 amendment)
pnpm hci instagram-followers [--limit=N] [--club=a,b] [--missing-logo] [--signed-in] [--dry-run] [--out=file]   # read linked public Instagram profiles (installed Chrome, ≥10 s apart, stops at any block) → data/imports/instagram-followers.json, then import; also saves the profile picture as a logo (ADR 0050; --missing-logo: only clubs with no logo); --dry-run lists them, no network (owner exception §21, ADR 0046)
pnpm hci import-instagram-followers data/imports/instagram-followers.json [--dry-run]   # follower counts for the Popularity sort: each count must appear in its saved text, which must name the account; the account must be a verified/probable link or be named like the club (else skipped and earlier claims from it rejected); stated claims, newest wins, ignored after 90 days (ADR 0046)
pnpm hci import-soco data/imports/soco.txt   # the owner's hand-saved copy of the SOCO directory (never fetched; ADR 0030)
pnpm hci curate [--dry-run] # apply the editor's club list (packages/pipeline/src/curated/list.ts, ADR 0024; `websiteQuote` confirms a generic-named club's site on a verbatim sentence naming it)
pnpm hci facts [--dry-run] [--club=a,b] [--file=batch.json]   # editor-read facts (src/curated/facts.ts): page fetched, quotes verified verbatim + evidence rules (ADR 0044)
pnpm hci logo-files         # Instagram profile-picture logos → apps/web/public/logos/ig/ (not in git), from kept copies; publish-pages.sh runs it before building (ADR 0050)
pnpm hci logos [--club=a,b] [--offline] [--reprobe] [--dry-run]   # each club's logo from its website's root page; candidate images measured once (image_probe), white/faint/tiny/too-wide/template/third-party ones skipped (ADR 0049)
pnpm hci page-text <url>   # a page's text as the pipeline reads it (robots checked): copy quotes from here
pnpm hci lifecycle [--dry-run]   # record organizations that ended (src/curated/lifecycle.ts): evidence page fetched, quotes verified (ADR 0038)
pnpm hci link-graph [--dry-run] [--fetch=N]   # sites/accounts for site-less clubs from stored pages, no search: data/reports/link-candidates.md (ADR 0038)
pnpm hci press [--publisher=crimson,independent,hpr] [--refresh]   # student-newspaper articles naming each club (headline/date/link; ADR 0026-0027)
pnpm hci press --rescore [--dry-run]   # re-judge stored press mentions with the current rules, restoring ones an earlier rescore rejected that now pass; no search, no fetch; press v6 reads the stored article copies: a passing mention (not in the headline or opening paragraph, named once), an IOP/PBHA/HUA headline or anything before 1990 is dropped; press v7: a sibling organization's headline ("Hasty Pudding Club …" on the Theatricals) or a shared-name one whose opening names the umbrella is dropped (ADR 0043)
pnpm hci summarize [--budget=USD] [--refresh]   # one-line club summaries anchored to the club's own text (SUMMARY_MODEL; ADR 0029)
pnpm hci categorize [--budget=USD]   # grounded LLM categories for clubs with none / no subcategory (estimates; ADR 0026)
pnpm hci categorize --from-names [--dry-run]   # categories a club's own name settles (explicit rules, estimates; ADR 0034)
pnpm hci submissions import <csv> [--dry-run]   # form responses → pending submissions + proposed fields; contact details stripped (ADR 0027, 0035)
pnpm hci submissions list [--status=…] | show <id> | stats
pnpm hci submissions accept <id> | accept-field <id> <field|#> [--value=…] [--term=…] [--override] [--no-fetch]   # Community claim; source link fetched and checked
pnpm hci submissions reject-field <id> <field|#> --reason="…" | reject <id> --reason="…" [--spam] | match <id> <slug>
pnpm ingest:enrich          # verify websites, crawl, extract; --club=slug --limit=N --stale-only --force --llm --llm-dry-run --budget=USD --browser
                            #   --offline: stored snapshots only, no requests (replay an extractor change for free; ADR 0038)
pnpm ingest:reconcile       # cross-club dedupe (strong ids only) + re-resolve everything; --dry-run
pnpm ingest:stats           # coverage report
pnpm ingest:export          # JSON/CSV to data/exports (public data only)
pnpm hci <cmd>              # full CLI: adapters | parse | discover | discover-web | find-sites | curate | press | crimson | categorize | submissions | enrich | reconcile | resolve | review | merge | unmerge | hide | unhide | reject | runs | stats | export

pnpm test                   # all Vitest suites (unit, fixtures, integration via in-process PGlite)
pnpm typecheck && pnpm lint && pnpm build   # or: pnpm check
# Full rebuild / refresh / backup / publish order: docs/runbook.md
```
(`hci`, not `pipeline`: pnpm 12 reserves `pnpm pipeline`.)

**Environment variables** (documented in `.env.example`; never commit real values):
Implemented: `DATABASE_URL`, `PGLITE_PORT`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_PATH` (static site sub-path), `CONTACT_EMAIL` (public corrections/takedown/crawler contact — a project address, never personal), `NEXT_PUBLIC_CORRECTIONS_FORM_URL` (optional corrections form), `SNAPSHOT_DIR`, `CRAWLER_USER_AGENT`, `CRAWLER_CONTACT`, `CRAWLER_MIN_INTERVAL_MS`, `LOG_LEVEL`, `EXTRACTION_MODEL` (default `claude-opus-5-5`), `EXTRACTION_EFFORT` (default `low`), `EXTRACTION_BUDGET_USD`, `SUMMARY_MODEL` (default `claude-sonnet-5-5`), `REFRESH_LLM_BUDGET` (refresh.sh; default 1), `ANTHROPIC_API_KEY` (optional; SDK credential resolution also accepts an `ant auth login` profile). `HCI_PAID_APIS` (`off`/0/false/no makes every Anthropic and Brave call refuse before sending; cached LLM results still replay; the local `.env` sets it off by default since 2026-10-04, so spend with `HCI_PAID_APIS=on <cmd>`, and refresh.sh then skips its LLM steps; docs/runbook.md "Working without spending money", ADR 0038). `PAGES_REPO` (publish-pages.sh's only allowed target; default `michaellhan/hclubs-site`). `HCI_INSTAGRAM` (`off`/0/false/no stops `instagram-followers`, including refresh.sh's monthly step; not a paid API) and `REFRESH_INSTAGRAM_LIMIT` (profiles per monthly refresh, default 110). `BRAVE_SEARCH_API_KEY` (optional; enables `find-sites --search`, `discover-web --search` and Crimson press mentions; the key draws on **prepaid** Brave credit; every command caps billed queries with `--max-queries`, default 100, and `stats` shows `braveQueriesThisMonth`). `NEXT_PUBLIC_CONTRIBUTE_FORM_URL` (optional https Google Form prefill link behind every "Help improve this page" chip and `/contribute`; placeholders `{clubref}`, `{club}`, `{slug}`, `{type}`, `{details}`, ADR 0035; fallback is a mailto to `CONTACT_EMAIL`) and `NEXT_PUBLIC_CLUB_MANAGER_FORM_URL` (same placeholders; used by `/for-clubs`, falling back to the contribute form).
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
  - **Owner exception (2026-10-03, ADR 0046 amendment): Instagram follower counts.** `pnpm hci instagram-followers` may read the *public* profile page of a club's linked Instagram account to take the follower count from its `og:description`, and nothing else. It never logs in or uses a session; it reads one page at a time in installed Chrome, at least 10 s apart (plus jitter), with Chrome's own user agent (nothing rotated); and it stops the whole run at the first sign of a block (a login or challenge redirect, an `is_from_rle` rate-limit flag, or three pages in a row without the description), with no retry. Instagram's robots.txt disallows all other crawlers (`User-agent: * / Disallow: /`); this exception is the owner's decision for this one purpose and does not extend to any other page, field or platform. **Extended (2026-10-05, ADR 0050):** the same page load may also take the account's profile picture (the image labelled `<handle>'s profile picture`) as the club's logo, downloaded once and served from our own copy; nothing else on the page. **Signed in (2026-10-05, owner, ADR 0050 amendment):** after Instagram rate-limited anonymous reads, the owner chose to let `instagram-followers --signed-in` reuse a Chrome profile they signed in to by hand (`pnpm hci instagram-login`, profile in `data/chrome-instagram/`, never in git; we never see or type the password), accepting the risk to that account. Same pace, same single page per club, same stop at any login, challenge or rate-limit sign; this overrides "never logs in or uses a session" for this one reader only. `HCI_INSTAGRAM=off` disables it; `refresh.sh` runs it only with `HCI_INSTAGRAM=on`, because installed Chrome got profile pages without the count in testing (the 2026-10-03 counts were read in the app's browser pane).
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
- **Coverage-and-correctness pass** (2026-10-01, ADR 0038, $0 external spend):
  - **Scope:** `scope-statements` extractor and `club.school` (2026-10-04: `extension` = Harvard Extension School, from scope-statements v7 and Mignone 1.0.1 names; shown as "Harvard Extension School group"); HLEP is an HLS group; graduate groups and ended orgs leave the recruiting board (static + Postgres) but answer a search for their name.
  - **Scope amendment (2026-10-12):** directory listing descriptions are scope-scanned (`listingScopeClaims`; description-passing adapters 1.1.0: HIVE → HGSE); listing scope claims are evidenced as scope-statements@<version> with a pass per listing page; scope-statements v9 reads nothing from a page about a subsidiary unit or from a "<club> – <School> Chapter" name (HCSSA is university-wide, not GSAS), never reads an "open to" list naming others beside College students as College, reads undergraduates + graduate students in any order as cross-school, and nothing from lists with alumni/friends/anyone; stored browser renders beat a newer static copy only when it is a JS shell; `discover --stored` replays stored listings; discovery files a seen mention's claims under its own (possibly merged) record.
  - **Lifecycle:** `hci lifecycle` (Undergraduate Council → replaced by the HUA, 2022, Wikipedia quotes); successor notice on the profile; rename duplicates merged (HSPDS→HCDU, SEDS→HUAC).
  - **Resolver-v3:** activity/source signals from live claims only (rejected dates kept UC "active").
  - **Sources:** `hci link-graph` attached 3 sites + 1 account offline; ownership-v1 (name match + confirmed account or Harvard group host); `siteIdentity` case-sensitive acronyms and the "Undergraduate" pitfall.
  - **Presentation:** A–Z category pages; lead-sentence one-liners; name-only panel; honest Join/dues/no-comp/first-years wording; primary category by independent support; name rules v3 (uncategorized 54→36).
  - **Audit:** network failures classified (12 findings, 8 high → 8, 0 high); 8 claims rejected (network member counts, national-program deadlines, alumni/partner forms); extractor 1.9.0 (abbreviation-safe sentences, process windows).
  - **Build/ops:** postbuild drops unused `_full.txt` and quantizes share cards (289→205 MB); guarded `publish-pages.sh`/`refresh.sh`; `HCI_PAID_APIS=off`; `enrich --offline`; privacy-scan reads JS chunks and finds secrets/local paths.
- **Precision and operations pass** (2026-10-01, ADR 0039, $0 external spend):
  - **Recruiting:** all live cycles read by hand (`recruiting-review`). Fixed: a second-round date shown as the deadline (Crimson Business Board → Sept 10), a priority deadline, audition days, phantom cycles whose term came from rejected dates. Extractor 1.13–1.14 (later-step deadlines, label/date layouts, body links only on pages about the club, former names as aliases).
  - **Retractions:** `snapshot_extraction` records every pass, so empty re-reads count; "not reproduced" rejections revive when reproduced.
  - **Ownership-v2:** title match + a Harvard publication, Wikipedia's article, or two sites linking the site by the club's name → verified (112 → 128); every resulting value change reviewed via `projection diff`.
  - **Scope v5:** program pages describing their own members; who may join ≠ where a group belongs; unknown scope stays on the board (decided from data).
  - **Safety/ops:** crawler SSRF guard (private/loopback/metadata addresses, every redirect hop); backups with tested restore; publish change summary, collapse guard and rollback; refresh logs what changed; `publicProfile` allowlist.
  - **Presentation:** no "Most complete"/"Recently updated" sorts; search ties by name, not completeness; natural queries ("learn to code"); off-season recruiting box; compare explains Unknown. Build 204 → 183 MB (named utilities for repeated class lists).
- **Joining-precision pass** (2026-10-02, ADR 0040, $0 external spend):
  - **Joining modes:** "open" needs a quote saying there is no selection when a club also comps or auditions (`join.open_beside_process`); open auditions and events aren't open membership; board, staff and venue applications aren't how members join (extractor 1.15, grounding `g7`). 27 wrong claims rejected after reading each.
  - **Wrong sites:** `reject-link` on a website releases its pages and rejects what only they said (national swe.org and bestbuddies.org). Club sites that are one folder on another host crawl only under that path (`pathScopedRoot`; 208 hbs.edu/foundation pages released).
  - **Ownership-v2 anchors:** "Name (Acronym)", "… official website", a dropped "Harvard" on Harvard pages; references land on the home page (131 verified, 120 probable).
  - **Dates:** no inferred year on undated news posts; no dates from production/venue application pages.
  - **Presentation:** compact "Not known yet" with the reason; search reads past verbs ("play poker", "perform theater"); intents without ambiguous words; home presets only joining facts; category stats need five clubs; no name-repeating aliases.
  - **Public data:** recruiting-cycle values went out with internal confidence/tier/source ids (86 profiles); every resolved value now passes `publicProfile`'s allowlist, and `privacy-scan` flags `internal_score`.
  - **Ops:** `refresh.sh` applies the audit's fact/recruiting fixes; name categories v4 (uncategorized 36 → 27).
- **Filter and joining pass** (2026-10-02, ADR 0041, $0 external spend):
  - **Derived joining facts:** `deriveJoining` (`joining-v1`, resolver-v4) projects `club.joining`, scoping processes to general membership or a role, and setting access to open, process, mixed or unknown. No-cut comps are recognized. Comp, first-years and dues are yes/no/unknown with a basis, and a specific class-year rule outweighs a generic one.
  - **Shared rules:** `classEligibility` (core) and `joinModeProblem` (evidence-rules) are used by the extractor (1.16.4), LLM grounding (g10) and the audit.
  - **Filters:** a new No comp filter; labels "First-years eligible", "Open membership" and "No dues"; filter groups Joining, Cost and Selection process; confirmed-only counts that say how many clubs don't say; Postgres parity.
  - **Other changes:** an undated "applications are open" expires after 21 days. Audit group `joining` (report-only). The static index is sorted by slug.
  - **Results:** first-years 37 → 61; first-years + open 4 → 15; first-years + no comp 22 (new). Open membership 179 → 23, because the directory flag now has its own filter (186). 25 wrong claims rejected.
- **Discovery and joining pass** (2026-10-02, ADR 0042 + ADR 0034 amendment, $0 external spend):
  - **Search:** constraint phrases read as filters ("no comp finance", "clubs for freshmen", "easy"), soft words re-rank (beginner, casual, low commitment), activity-list mentions no longer match alone, abbreviations credit their full form, demonym/place pairs, Build and Social concepts, `suggest()` typeahead helper, `cleanQuery`.
  - **Data:** `joining.noExperience` (joining-v2, 43 clubs, from verbatim quotes only; yes/unknown, never no); name categories v5 (uncategorized 28 → 20); extractor 1.16.5 (pitch/case competitions aren't application pages); audit rules for site-builder template text and constitution headings.
  - **Saved clubs** (`/saved`, localStorage) and live directory search on the static export (trailing-slash fix).
- **Top-club pass** (2026-10-02, ADR 0044, $0 external spend):
  - **Why:** a live-site review found the clubs students check first were the weakest (the Crimson had no website and "Joining: Unknown").
  - **Editor-read facts:** `curated/facts.ts` + `hci facts` (page fetched, quote verbatim, evidence rules, page keeps its tier). 61 facts at 42 clubs; 56 official sites confirmed in the curated list (thecrimson.com, iop.harvard.edu, pbha.org, hnmun.org …), then crawled. On those 78 clubs: website 58→64, how to join 40→50, no experience needed 0→21, first-years 20→25.
  - **Fixes:** news sentences ("Only … seniors can use AI") no longer read as eligibility (`classEligibility`); leader/board/staff application pages are role pages (`classifyPageRole` → team, skipped by the application pass); recruiting seasons skip role sentences (extractor 1.16.12). Empty recruiting cycles (all facts rejected) no longer render.
  - **Reviewed by hand:** rejected the HUEA team application, the Outing Club's trip-leader application/deadline/stages, a parked Woodbridge domain, a personal Facebook profile, two non-description texts and a screenshot logo.
  - **Second batch** (95 clubs with a site but unknown joining): 22 more facts, 41 more confirmed sites. Most of these clubs' pages don't say how members join (a source gap). Wrong sites rejected: HUTV and Science Review domains now spam, men's club soccer → a town youth league, the undergraduate LMIG → the HMS group. Extractor 1.16.13: a date right after "Board Applications…" (same block or heading) isn't a member deadline. Google Form owner ids (`ouid`) are stripped from URLs (`withoutTrackingParams`; displayed links and public source URLs; resolver-v6).
  - **Sources cleanup** (extractor 1.16.14): privacy/terms/permissions pages yield nothing and crawl as "other"; posts yield no links (a club's news posts still give recruiting dates). A profile's Sources list leaves out policy pages and posts that only repeat links (`listedSources`). Audit checks `evidence.policy_page` / `evidence.post_page_link` reject claims backed only by such pages. `isArticleUrl` / `isLegalPageUrl` now live in `@hci/core`.
  - **Free fixes** (2026-10-03): `category.career_center_stamp` also covers Wikipedia's "Pre-professional" section and categorizer estimates read off the career-center page, unless the club's name is business/finance/law-like (9 labels dropped: Robotics, Society for AI, Engineering Society…). Profiles show only meaningful directory tags (PBHA program, Club sport, IOP program, Final club…; `shownTags`), not listing noise ("seas-affiliated"). Search: soft words ("beginners") no longer lift clubs matched only through a broad umbrella category; the empty state no longer says "check the spelling" when a filter is what ruled results out.
- **Coverage pass** (2026-10-12, owner-approved paid search and LLM): website search over site-less clubs (+4 sites), recruiting pass with search fallback (29 pages from 300 queries: the joining gap is a source gap, not a search gap), LLM over every uncached crawled page. Fixes: recruiting crawls stay in a club's own folder on a shared host; an off-site page must place the club at Harvard (`offSitePageAboutClub`); a guessed year contradicting a named academic year or dated post URL drops the date; process words in email addresses and attendee applications aren't join modes (extractor 1.16.36, grounding g16); duplicate Facebook page addresses fold into one link. Ballroom Team merged into the club-sport record (shared @harvardballroom).
- **Round 3 data pass** (2026-10-12, from student testing): conference-registration pages (delegates, high school, MUNager, "college students are not eligible") never give join modes, eligibility or dates (`conferenceRegistrationProblem`, audit `recruiting.conference_registration`; HMUN/HNMUN); guessed years read against a named season ("2026–27 season … due February 6"); `check-forms` reports past-cycle titles and the audit reads term codes in link paths ("/f25"); curated facts take round facts (process type, the club's own words) and verbatim one-liners; stated stages follow process order; press v5 drops a mention whose headline names another indexed club and not this one; joining-v3 reads more "no experience needed" wordings and a club's own "no-cut" statement; meeting length isn't hours per week; board elections aren't activities; long mission paragraphs give only their mission sentence; scope v10 (PHIT, GSAS Biotech graduate); name rules v8 (a Shakespeare company is theater); PBHA's Common Application recorded for 25 term-time programs; sources list one page per paginated listing (extractor 1.16.38, grounding g17, resolver-v18, curated list v17).
- **Round 5 data pass** (2026-10-13, ADR 0033 amendment, $0 external spend): event announcements ("excited to announce …") and follow-us notices are never About text; audition instructions ("prepare two contrasting pieces") aren't experience requirements; an LLM stage is no more specific than its label (HUCG's second round isn't a case interview) (extractor 1.16.43, grounding g20, audit `description.announcement`, `description.experience_audition_prep`). Editor-read schedules (`curated/batches/round5-schedules.json`): meeting times for 21 clubs (Kuumba, BachSoc, PADAME, Steelpan, IOP programs, PBHA programs, club sports), the Jazz Orchestra's fall + by-appointment auditions, and one-liners for HVA, SIAMA, HOLA and Bhangra from Harvard pages. Curated list v21: Harvard Undergraduate Ventures (its site's name, + Entrepreneurship), the Photography Club → Hobbies & Games. Wrong categories (VISION pre-professional, HMUN/Debate Council public service), an old marshal-candidates list and an unrelated HPR article as press rejected.
- **President's check** (2026-10-13, ADR 0033/0043/0044 amendments, $0 external spend): a club president compared eight profiles with the clubs' own sites. Show seasons and named production-position comps ("Script, lyrics … comps are all held in the Spring") are never recruiting seasons (`seasonScopeProblem`); booking pitches are never About text; an LLM mission is never stitched from two sentences; a site menu is never activities (extractor 1.16.46, grounding g23). Press-v7: sibling organizations ("Hasty Pudding" Club / Theatricals / Institute) keep their own headlines (`siblingInHeadline`). Display: two emails at most, general inboxes first; roster pages leave Sources; Google Form `/edit` links open as `/viewform`; no Travel row from the directory's flags; dues show their period (`DuesValue.period`, "$20 per 6 months"); resolver-v22 folds HCS's repeated event lists. Rejected by hand: the umbrella Institute's borrowed joining, forms, seasons and descriptions, HUWIB's career-center 700+ (its site says over 400), the Crimson's menu activities and stitched mission, the Kroks' booking pitch. Editor-read batch `round6-president-check.json` (Kroks, HUWIB seasons, Outing Club dues, PBHA's one-liner).
- **M4 — Recruiting.** Groundwork done (2026-09-30, ADR 0031): `recruiting` pass, past-term suppression, recruiting quality audit; coverage numbers in `docs/recruiting.md`.
  Remaining: scheduled `recruiting --stale-only` rechecks during recruiting windows; deadlines for clubs without public recruiting pages (submissions).
  - **Program applications and announced later rounds** (2026-10-12, ADR 0051 amendment):
    - `programApplicationProblem` (sentence, or the section heading above it via `headingAbove`) keeps trek, trip, grant, scholarship, stipend, award and money-backed fellowship applications out of join modes, recruiting seasons, dates and apply links: deterministic 1.16.26, LLM `g14`, audit `recruiting.program_application`. Intro fellowships stay.
    - An interest-form link with no live round reads "Interest form" on the profile.
    - `announcedLaterRound` / `beyondAcademicYear` (`local/cycles.ts`): an undated round a club or official page announces for a later term outranks the usual-season pattern. It drives the profile's When ("Next auditions: Fall 2027"), compare's Next chance, row pills, the board's next chances, and Still time to join (only within this academic year).
    - A cycle with every fact rejected has no `lastVerifiedAt`.
  - **Student-testing data pass** (2026-10-12, ADR 0044, 0034, 0024 and 0038 amendments, $0 external spend):
    - **Next rounds:** deterministic 1.16.27 reads a recurring time beside a new intake of members ("Our analyst classes each semester…") as a recruiting season; editor-read seasons for the Crimson's Business and Technology boards (the Crimson's about page) and HDAG. Finance & consulting clubs with a season 4 → 6 of 20; the rest only name single rounds, so they stay unknown. HUCG's stages are its written application and two interview rounds (an LLM list of recruiting events rejected).
    - **Joining:** HPR rolling recruiting of writers and its meeting time (its comp is the tech team's, a role the joining rules can't scope, so it isn't recorded); WiCS a no-cut comp; "email list" forms are mailing lists; "Auditions"/"Tryouts"/"Casting" links are apply links (20 clubs' audition and casting pages replace "Check how to apply").
    - **Categories:** `name-category` v7 (breaking, tap, Gilbert and Sullivan, "Music Association/Collective/Ensemble"; six clubs) and curated list v12 (Deepam, Ghungroo → Dance; Immediate Gratification Players, Asian Student Arts Project → Theater). Startups at Harvard's finance estimate and a duplicate activity rejected.
    - **Descriptions:** a first-person quotation isn't a description (the Kroks' testimonial); a directory's own meta description ("The Institute of Politics (IOP) at…") isn't the club's (1.16.30–31, 19 claims retracted, six IOP programs got their own one-liner); resolver-v14 reads "..." as cut off (HRMDC) and falls back to a same-tier one-liner over an over-long paragraph (Computing Contest Club). SAMC's site was found by domain guessing. SAA, SABA, SAMA, SAWC, QSA, LEAD and the Breakers still have no one-liner: no stored or Harvard page describes them in a sentence that can stand alone.
    - **Display:** another club's own page is labelled a Harvard-related publication on a profile, not "Club website"; displayed Google Docs/Forms links drop `usp=` (not `pp_url`).
- **Data-quality audit** (2026-10-01, ADR 0033): `pnpm hci audit` (pure check groups over the whole DB, ranked findings, high-confidence fixes only). Results:
  - Rejected 150 wrong or unsupported claims: 62 links, 22 recruiting dates, 20 descriptions/summaries, 17 join modes/dues, 12 activities, 11 member counts/hours, 6 logos.
  - Merged 7 duplicate pairs.
  - Shared evidence rules now apply in both extractors (deterministic 1.7.0, LLM `g5`).
  - Resolver-v2, `summary-v2`, Facebook page URLs fixed, deep links on shared hosts kept as they are.
  - Review round: 2 more merges, 67 more rejections (HMUN conference registration dates; the career center's blanket "pre-professional" label; links and facts checked by hand), and 56 findings kept with reasons (`audit-dismiss`). A final pass trimmed overclassified categories, rejected year-only descriptions and four unusable favicons. The audit now reports a single watch item (a site returning HTTP 500).
  - **People in club text** (2026-10-12, ADR 0033 amendment): `namesPeopleProblem` / `eventBlurbProblem` in `evidence-rules.ts` keep names with class years, production credits, named choreographer/teacher lists and named leaders out of descriptions, missions, activities and summaries, and show blurbs out of missions (deterministic 1.16.24, LLM `g13`, `summarize`, `facts`, audit `*.names_people`, `*.event_blurb`, `description.activity_names_people`). A name inside the club's own name never counts. `<br>` and zero-width spaces now separate words in page text. Confirm-only re-reads match free text ignoring spacing and zero-width spaces, onto the existing claim (1.16.25).
- **Contribution workflow** (2026-10-01, ADR 0035):
  - **Links.** Typed, prefilled form links on every profile and on `/contribute`.
  - **Review.** Import produces per-field proposals, with a review CLI (`show` / `accept-field` / `reject-field` / `match` / `stats`) and partial accepts.
  - **Evidence and conflicts.** Evidence links are fetched and checked against the value; conflicts are guarded.
  - **Privacy.** Contact details are stripped.
  - **Comp reports.** The comp-report table and k-threshold aggregation are built, with display off.
- **Launch audit** (2026-10-01, `docs/launch-audit.md`):
  - **Published profiles** go through `publicProfile()` (no evidence quotes, no unshown alternatives, no personal or placeholder emails, public search URLs).
  - **New audit rules:** `description.names_people`, contact-page junk, and `link.personal_email` / `link.placeholder_email`.
  - **Rendering:** profiles render in the static HTML (no route `loading.tsx`), and every page has canonical and `og:url` metadata.
  - **Accessibility:** WCAG AA contrast in light and dark modes, and a skip link.
  - **Compare** follows merged slugs.
  - **Publishing** keeps 14 days of old chunks.
  - **Copy** corrected on About, Methodology and the crawler page; maintainer runbook in `docs/runbook.md`.
  - **Follow-up:**
    - The browser bundle imports only `@hci/core/browser` (no Zod; a test enforces it), cutting JS from about 280 to 190 KB gzipped.
    - The fetcher reports unreachable hosts as network errors and tries the www/bare twin; audit rule `link.unreachable`.
    - 9 dead website links rejected.
- **Product pass** (2026-10-01, ADR 0036):
  - **Search:** typed match reasons, name initials ("hccg"), plural/UK spelling variants, last-word-only prefixes, narrower concepts, partial-match fallback; ranking regression suite (`packages/db/test/search-ranking.test.ts`).
  - **Directory:** facet counts, synced checkboxes, No dues filter, relaxation suggestions, copy link, ↑/↓/Esc keyboard flow.
  - **Profiles:** tappable facts with sources and conflicts, fixed glance rows, live joining status, status-aware Apply, stage flow, "Missed this deadline?" alternatives.
  - **Compare, recruiting, home, categories:** deterministic compare summary and differences-only; "started, no deadline" board section; grouped intents; category overviews.
  - **Data fixes:** "Decision Released" no longer read as an opening (extractor 1.7.1); application-process text no longer taken as a mission (1.7.2); DST offsets; far next-term deadlines are upcoming; opens-after-deadline ignored and audited.
  - **Taxonomy:** every category described; Wikipedia's combined "Theater and dance" heading no longer tags clubs with both (adapter 1.0.1, 24 claims retracted); name rules settle dance/theater/a cappella/music (`name-category` v2).
  - **Also:** `/about/glossary`, recruiting board "Due in the next 7 days", reworded activity bullets collapsed, duplicate news links folded, axe-clean landmarks.
- **Quality pass** (2026-10-01, ADR 0037):
  - **Recruiting:** 73 wrong claims rejected — outsider applications (conference scholarships, attendee rounds, a high-school essay contest), years guessed on old pages ("Spring ’16"), weekday-only and newsletter dates, job ads, and join modes that negate their quote ("no auditions" → audition). Shared rules in `evidence-rules.ts`; new audit checks; extractor 1.8.0, grounding `g6`.
  - **Labels:** "No comp needed" (was "No comp or application"; the directory flag says only "no comping"), "Say they take first-years" with help text; pills use the filter's rule.
  - **Search:** LGBTQ+, first-gen and mental-health concepts; ranking fixes (see §13); benchmark script.
  - **Similar clubs:** no "Similar description" without descriptions; shared name words and topics as signals.
  - **Tools:** `snapshots search`, `opportunities` (finding: eligibility/hours/size are rarely stated on crawled pages — a source gap, not an extraction gap), queue's deadlines-to-confirm list; static 404 recovers mis-cased club links.
- **M5 — Contributions.** Remaining: a server endpoint, Harvard email auth (magic link), HMAC-keyed rate limits, a moderation UI, club-manager verification.
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
    After fixing an extractor, bump its version, re-run it, then `pnpm hci retract-unreproduced --extractor=<name> [--version=<current>] [--field=<keys the fix touched>] [--only-restated] [--club-sources=only|exclude]` (claims are rejected with a reason, never deleted; a claim counts only when every page behind it was re-read by the new version, that copy or a newer one; former names are never retracted; `--only-restated` limits it to values another kept value of the club already says, for LLM wording churn; `--club-sources=only|exclude` limits it to claims read, or not read, on the club's own pages (an established channel, or the host of its linked website): the owner trusts what clubs say about themselves (2026-10-13), so club-sourced claims are retracted only as repeats; ADR 0043 amendment). Enrich re-reads stored pages its crawl no longer reaches, confirm-only (ADR 0051); such a re-read also revives claims retracted as "not reproduced" that the page still says, and a recorded pass whose evidence doesn't cover what it claimed (lost writes) counts as unread; a site already linked to a club is re-confirmed by its own spellings of the club's name or a host that spells it (ADR 0051 amendment, 2026-10-12). For stricter LLM grounding without a prompt change, bump `GROUNDING_REVISION` so reruns replay from cache for free.
11. Never write projection tables from ingestion code. Never mutate snapshots. Never hard-delete claims (change `status`).
12. Don't commit secrets, `.env`, snapshot blobs, large datasets, or build output. Commit migrations.
13. Prefer small, reviewable commits with descriptive messages.
14. Run `pnpm hci audit` after an ingestion run and before publishing. `--apply` fixes only high-confidence findings; read a new rule's output against live data before letting it attach a fix, and add a regression fixture for every bug class it catches (ADR 0033).
15. Anything published about a club goes through `publicProfile()` (`packages/db/src/queries/public.ts`): evidence quotes and unshown competing values stay internal, because they can name people (launch audit). Every resolved value (club, cycle, selectivity) passes its allowlist; `privacy-scan` fails on internal scores in the build (ADR 0040). Never add a route `loading.tsx` above prerendered pages; it hides their content behind a skeleton until JavaScript runs.
16. In autonomous sessions, follow §26: work from `.claude/autonomous-backlog.md`, run every significant change through the quality loop, and keep going until the backlog is truly exhausted or blocked.

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
| 0019 | Reversible audited merges; auto-merge only on strong identifiers; the survivor keeps its own name, absorbed names become aliases (amendment, resolver-v9); different folders on a shared host, and accounts read only off it, are not strong identifiers (amendment, matcher-v4) | `docs/decisions/0019-reversible-merges.md` |
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
| 0034 | Discovery: concept/synonym search with typo correction and match reasons, intents, presets, similar clubs, browse-friendly taxonomy (tech/health/startups top-level), name-settled categories | `docs/decisions/0034-discovery.md` |
| 0036 | Facts open to their sources (amends 0028); unknown shown with contribution links; live, never-overselling joining state; typed search reasons, initials, word variants, narrower concepts; facets, No dues filter, alternatives; explain/coverage/queue/privacy-scan tools | `docs/decisions/0036-inspectable-facts-and-discovery-pass.md` |
| 0038 | School scope from self-describing statements (+ `club.school`; amendment 2026-10-12: listing descriptions, a club's chapter isn't the club, stored browser renders, `discover --stored`), graduate groups and ended orgs off the recruiting board but findable by name; sourced endings (`club.lifecycle`, successor ≠ merge); resolver-v3 live-claim signals; ownership-v1; link-graph source discovery; A–Z category pages; lead-sentence one-liners (amendment 2026-10-13: no mid-sentence fragments or Wikipedia marks, resolver-v20); guarded publishing/refresh; paid-API kill switch and worst-case budget reservation; smaller static build | `docs/decisions/0038-scope-lifecycle-ownership-and-safe-publishing.md` |
| 0039 | Recruiting precision (later-step deadlines, phantom cycles, body links), `snapshot_extraction` + revivable retractions, ownership-v2 (independent named references), scope v5, projection diff/recruiting review/name-only diagnosis/lifecycle leads, SSRF guard, backups, publish check + rollback, publicProfile allowlist, no completeness sorts/ties | `docs/decisions/0039-precision-ownership-and-operations.md` |
| 0040 | Joining-mode precision (open needs "no selection" beside a selective mode; leadership/venue applications), `disownSite` on rejecting a wrong website, path-scoped crawls on shared hosts, ownership-v2 anchor forms, no years on undated posts; compact "Not known yet" with its reason, verb-tolerant natural search, intents without ambiguous words, joining-fact presets; refresh applies audit fixes | `docs/decisions/0040-joining-precision-wrong-sites-and-clearer-unknowns.md` |
| 0041 | Derived joining facts (`club.joining`): processes scoped to general membership or a role, open/process/mixed access, comp, first-years and dues as yes/no/unknown with a basis; shared class-year and join-mode rules; yes/no/unknown filters with a separate No comp filter; undated "open" expires after 21 days | `docs/decisions/0041-derived-joining-facts-and-filters.md` |
| 0042 | `joining.noExperience` from verbatim experience quotes (yes/unknown only); committee applications are roles; name categories v5; template/constitution audit rules | `docs/decisions/0042-no-experience-fact-and-data-pass.md` |
| 0043 | Clean link labels (CSS/icon/Folder: text), outsider grant/declaration/Zoom links, nav-text rule, stricter press mentions (`press --rescore`), near-duplicate activities folded in the resolver (resolver-v5). Amendment (press v4): distinctive one-word names (`DISTINCTIVE_NAME_WORDS`, capitalized, not shared by another club) stand in passing mentions; a publication's own articles are not press; rescore restores what an earlier rescore rejected | `docs/decisions/0043-link-labels-press-strictness-and-activity-dedupe.md` |
| 0044 | Editor-read facts: club-level values listed with the verbatim sentence and page that state them; fetched, quote-verified and checked by the extractors' evidence rules; the page keeps its own tier (club site only when verified) | `docs/decisions/0044-editor-read-facts.md` |
| 0046 | Popularity sort, the default directory order: stated Instagram follower counts (`club.instagram_followers`, importer, resolver-v8, `instagramFollowers` in the index) order clubs, uncounted clubs follow in Suggested order; counts never displayed; owner override of the no-prestige-ranking non-goal and ADR 0039's neutral default. Amendment: counts read from public profile pages (`instagram-followers`, owner exception to §21), account check in the importer, 90-day `maxAgeDays` (resolver-v10), monthly capped refresh | `docs/decisions/0046-popularity-sort.md` |
| 0051 | Stale pages and closed forms: enrich re-reads stored pages its crawl no longer reaches (confirm-only; revives wrongly retracted claims, re-reads passes that lost their writes); `retract-unreproduced` counts a newer copy of the page and never retracts former names; `check-forms` re-fetches shown forms; audit `application.form_deleted`, `application.past_cycle`, `/closedform`, `--apply-only`; refresh applies the form checks and link retractions; amendment: program applications (treks, grants) aren't recruiting, and a round announced for a later term outranks the usual seasons | `docs/decisions/0051-stale-pages-and-closed-forms.md` |
| 0050 | Instagram profile pictures as logos: read on the follower-count page load (owner extends the §21 exception), same account check, `club.logo` claim keyed by the picture's unsigned address, served from our own 160 px copy (`hci logo-files` → `public/logos/ig/`); site logos still win | `docs/decisions/0050-instagram-profile-pictures.md` |
| 0049 | Logos chosen by a `logos` stage from the website's root page: header logos found by slot/home link/site name, Wix originals, candidate images measured once (`image_probe`: size, white-on-transparent, ink on our tile), shared URL + image rules with the audit; deterministic extractor no longer claims logos; UI accepts wordmarks to 3.3:1 | `docs/decisions/0049-measured-logos.md` |
| 0048 | `/recruiting` board retired: route redirects to the directory's Recruiting now filter; home link switches to join-anytime clubs when no round is open; builders kept for profiles and compare | `docs/decisions/0048-retire-recruiting-board.md` |
| 0047 | Clubs for your resume (`/match`): matched in the browser with the search model (concepts + rare club-name words, capped per interest, spread across interests); resume never leaves the browser; no LLM until a server exists | `docs/decisions/0047-resume-match.md` |
| 0045 | Club officer update form (`/for-clubs`): structured questions → importer-ready lines via the existing form; no server; labels shared by form and importer | `docs/decisions/0045-club-officer-form.md` |
| 0037 | Recruiting evidence rules (outsider applications/links, guessed years, weekday-only dates, negated processes) shared by extractors and audit; "No comp needed" / "Say they take first-years" labels; ranking and similar-clubs amendments; snapshot search and extraction-opportunity tools | `docs/decisions/0037-trustworthy-recruiting-and-ranking.md` |
| 0035 | Contributions: typed prefilled form links, per-field proposals with partial accepts, community claims never sourced from the submitter's URL (the URL is fetched and checked instead), conflict guard, contact details stripped; comp-report table + k-threshold aggregation (display off) | `docs/decisions/0035-contribution-workflow.md` |

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

---

## 26. Autonomous product development

Durable rules for long, self-directed product sessions. They sit on top of §2 and §21: those still hold, especially **never fabricate club information**.

### 26.1 Goal
HClubs should become the obvious tool Harvard students use to discover clubs, decide which interest them, compare them, and figure out how to join. Optimize for the questions students actually ask:
- What clubs should I look at? What matches my interests?
- Can I join? Can I join right now?
- Is there an application, comp, audition or tryout?
- How much time does it take? What do members actually do?
- What deadlines matter?
- Which clubs should I compare? What should I do next?

### 26.2 Priorities (roughly in order)
1. Broken behavior and correctness
2. Search/discovery quality
3. Recruiting and deadlines
4. Homepage usefulness
5. Club-card usefulness
6. Club-detail-page usefulness
7. Save/shortlist/compare workflows
8. Mobile UX
9. Accessibility
10. Performance
11. Visual polish

- Prefer major user-value improvements over cosmetic churn. Avoid giant rewrites unless they create obvious product value.
- Don't add a filter just because a field exists; add it when students would use it and the data covers enough clubs.
- Don't expose backend or data complexity to users. Present information simply and confidently; the existing correction flow handles mistakes. Don't build elaborate verification/provenance UX (ADR 0028/0036). The claims/evidence layer stays as the internal foundation.
- Don't fabricate. Unknown stays unknown, phrased helpfully, with a path to contribute.

### 26.3 Autonomous loop
Keep a prioritized backlog in `.claude/autonomous-backlog.md` (sections ACTIVE, READY, IN REVIEW, BLOCKED / HUMAN REVIEW, COMPLETED THIS RUN; priorities P0–P3; each item says the user problem, the evidence and the owning agent from `.claude/agents/`). After each meaningful task:
1. Test it.
2. Have another agent review it (`code-reviewer`; `adversarial-qa` for significant changes).
3. Fix real issues.
4. Add regression tests where useful.
5. Update the backlog.
6. Pick the next highest-value unblocked task.
7. Continue immediately.

Don't stop just because the initially requested features are done. When the backlog gets thin, generate work from real product problems, never busywork:
- run another UX audit or test another student persona (`product-ux`)
- inspect mobile, club pages, recruiting flows, and compare/saved workflows
- test search quality and unusual filter combinations
- inspect TODOs/FIXMEs
- run accessibility and performance checks
- look for inconsistent or confusing UI
- devise realistic student tasks and try to complete them

Anything that needs the owner goes to BLOCKED / HUMAN REVIEW while you continue with other work: paid API spend, publishing to hclubs.app, pushing, destructive data changes, legal or privacy judgment calls, and changes to these principles.

### 26.4 Quality loop
For significant changes: **implement → test → adversarial QA → repair → regression test → product review.** A feature isn't finished because it compiles: typecheck, lint and tests pass, it's verified in the browser (desktop and mobile), reviewed, and the docs are updated (§23).

### 26.5 Continuation hook (opt-in)
`touch .claude/autonomous.on` starts autonomous mode and `rm .claude/autonomous.on` ends it. While it's on, a Stop hook (`.claude/hooks/stop-continue.mjs`) keeps the lead session working as long as the backlog has P0–P2 items in ACTIVE / IN REVIEW / READY, or a typecheck/lint/test/build it ran this session is still failing. It lets the session stop when nothing changed since its last continuation, after 25 continuations, and always for subagents and teammates. Edits get Prettier (on files already Prettier-clean) plus single-file ESLint; tests never run automatically. To disable it: `HCLUBS_AUTONOMOUS=0`, or `"disableAllHooks": true` in `.claude/settings.local.json`. Details and self-test: `.claude/hooks/README.md`, `bash .claude/hooks/test-hooks.sh`.
