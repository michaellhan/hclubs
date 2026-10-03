import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "@hci/core";

/**
 * Database schema. See docs/data-model.md for the rationale behind each table and
 * CLAUDE.md §5 for the claims/evidence architecture.
 *
 * Layers:
 *   evidence   — source, source_snapshot, fetch_attempt, ingestion_run
 *   assertions — claim, claim_evidence (+ entity_mention, merge_candidate)
 *   projection — club display columns, club_alias, club_link, club_category,
 *                membership_estimate, recruiting_cycle display columns, recruiting_stage,
 *                club_search_document. Written ONLY by the resolver; rebuildable.
 *
 * Enum policy: Postgres enums only for closed lifecycle states. Open taxonomies
 * (source types, link kinds, org types, categories, …) are text validated by Zod in @hci/core.
 */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// --- Closed lifecycle enums --------------------------------------------------------------

export const recordStateEnum = pgEnum("record_state", ["active", "merged", "hidden"]);
export const dataOriginEnum = pgEnum("data_origin", ["ingested", "fixture", "editorial"]);
export const assertionKindEnum = pgEnum("assertion_kind", [
  "stated",
  "inferred",
  "computed",
  "user_reported",
  "editorial",
]);
export const claimStatusEnum = pgEnum("claim_status", ["active", "superseded", "retracted", "rejected"]);
export const subjectTypeEnum = pgEnum("subject_type", ["club", "recruiting_cycle"]);
export const runStatusEnum = pgEnum("run_status", ["running", "succeeded", "partial", "failed"]);
export const fetchStatusEnum = pgEnum("fetch_status", [
  "ok",
  "not_modified",
  "http_error",
  "network_error",
  "robots_disallowed",
  "skipped",
]);
export const mentionResolutionEnum = pgEnum("mention_resolution", [
  "definite",
  "probable",
  "ambiguous",
  "new",
  "pending",
  "manual",
]);
export const mergeCandidateStatusEnum = pgEnum("merge_candidate_status", [
  "proposed",
  "confirmed",
  "rejected",
  "undone",
]);
export const submissionStatusEnum = pgEnum("submission_status", [
  "pending",
  "accepted",
  "partially_accepted",
  "rejected",
  "spam",
]);
export const proposalStatusEnum = pgEnum("proposal_status", ["pending", "accepted", "rejected"]);
export const compReportStatusEnum = pgEnum("comp_report_status", ["pending", "accepted", "rejected"]);

// --- Identity + club projection ----------------------------------------------------------

export const club = pgTable(
  "club",
  {
    id: id(),
    slug: text("slug").notNull(),
    canonicalName: text("canonical_name").notNull(),
    recordState: recordStateEnum("record_state").notNull().default("active"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("ingested"),
    mergedIntoClubId: uuid("merged_into_club_id").references((): AnyPgColumn => club.id),

    // Projection columns — written only by the resolver (see src/resolve).
    acronym: text("acronym"),
    shortDescription: text("short_description"),
    longDescription: text("long_description"),
    orgType: text("org_type"),
    recognitionStatus: text("recognition_status").notNull().default("unknown"),
    activityStatus: text("activity_status").notNull().default("unknown"),
    affiliationScope: text("affiliation_scope").notNull().default("unknown"),
    joinModes: text("join_modes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    freshmenEligible: boolean("freshmen_eligible"),
    eligibleClasses: text("eligible_classes").array(),
    /**
     * Derived joining facts (@hci/core `deriveJoining`, ADR 0041): general vs role-only
     * processes, open/process/mixed access, comp, first-years and dues as yes/no/unknown,
     * each with the claims and pages it rests on. `join_modes` and `freshmen_eligible` are
     * written from it.
     */
    joining: jsonb("joining"),
    /** Derived activity assessment (see @hci/core assessActivity). */
    activityConfidence: real("activity_confidence"),
    activityReasons: text("activity_reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Latest observation by an official (tier ≤ 2) source. */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    hoursPerWeekMin: real("hours_per_week_min"),
    hoursPerWeekMax: real("hours_per_week_max"),
    memberCountMin: integer("member_count_min"),
    memberCountMax: integer("member_count_max"),
    /** Latest stated Instagram follower count (`club.instagram_followers`); sorts the directory only (ADR 0046). */
    instagramFollowers: integer("instagram_followers"),
    /** Per-field provenance for display: Record<fieldKey, ResolvedValue | ResolvedValue[]>. */
    fields: jsonb("fields").notNull().default({}),
    completeness: real("completeness").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    conflictFields: text("conflict_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolverVersion: text("resolver_version"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("club_slug_key").on(t.slug),
    index("club_record_state_idx").on(t.recordState),
    index("club_join_modes_idx").using("gin", t.joinModes),
    check("club_merged_consistency", sql`(${t.recordState} = 'merged') = (${t.mergedIntoClubId} IS NOT NULL)`),
    check("club_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const clubSlugHistory = pgTable(
  "club_slug_history",
  {
    slug: text("slug").primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("club_slug_history_club_idx").on(t.clubId)],
);

// --- Taxonomy -----------------------------------------------------------------------------

export const category = pgTable(
  "category",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id").references((): AnyPgColumn => category.id),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("category_slug_key").on(t.slug), index("category_parent_idx").on(t.parentId)],
);

// --- Evidence layer -----------------------------------------------------------------------

export const ingestionRun = pgTable(
  "ingestion_run",
  {
    id: id(),
    job: text("job").notNull(), // e.g. "discover", "resolve", "seed"
    adapter: text("adapter"),
    adapterVersion: text("adapter_version"),
    status: runStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    options: jsonb("options").notNull().default({}),
    counters: jsonb("counters").notNull().default({}),
    errorSummary: text("error_summary"),
    gitSha: text("git_sha"),
  },
  (t) => [index("ingestion_run_started_idx").on(t.startedAt), index("ingestion_run_adapter_idx").on(t.adapter)],
);

export const source = pgTable(
  "source",
  {
    id: id(),
    url: text("url").notNull(), // as first seen
    normalizedUrl: text("normalized_url").notNull(),
    domain: text("domain").notNull(),
    sourceType: text("source_type").notNull(),
    trustTier: smallint("trust_tier").notNull(),
    title: text("title"),
    /** Set once the source is established as a specific club's own channel. */
    ownerClubId: uuid("owner_club_id").references(() => club.id, { onDelete: "set null" }),
    /** Owner/publisher label, e.g. "Phillips Brooks House Association". */
    publisher: text("publisher"),
    adapter: text("adapter"),
    /** For crawled club pages: home | about | join | recruiting | faq | team | events | sponsors | contact | other. */
    pageRole: text("page_role"),
    /** Page appears to require JavaScript rendering (not fetched with a browser yet). */
    needsBrowser: boolean("needs_browser").notNull().default(false),
    isFixture: boolean("is_fixture").notNull().default(false),
    recheckIntervalHours: integer("recheck_interval_hours"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("source_normalized_url_key").on(t.normalizedUrl),
    index("source_domain_idx").on(t.domain),
    index("source_owner_club_idx").on(t.ownerClubId),
    check("source_trust_tier_range", sql`${t.trustTier} BETWEEN 0 AND 9`),
  ],
);

/** Immutable. One row per distinct content of a source; identical re-fetches reuse the row. */
export const sourceSnapshot = pgTable(
  "source_snapshot",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id),
    ingestionRunId: uuid("ingestion_run_id").references(() => ingestionRun.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    finalUrl: text("final_url").notNull(),
    httpStatus: smallint("http_status"),
    contentType: text("content_type"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    contentSha256: text("content_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Key in the SnapshotStore (raw bytes live outside Postgres). */
    storageKey: text("storage_key").notNull(),
    /** Extracted visible text, kept in Postgres for search/extraction/debugging. */
    extractedText: text("extracted_text"),
    fetchMethod: text("fetch_method").notNull(), // static | browser | api | manual_upload | fixture
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("source_snapshot_content_key").on(t.sourceId, t.contentSha256),
    index("source_snapshot_source_fetched_idx").on(t.sourceId, t.fetchedAt),
  ],
);

export const fetchAttempt = pgTable(
  "fetch_attempt",
  {
    id: id(),
    sourceId: uuid("source_id").references(() => source.id),
    ingestionRunId: uuid("ingestion_run_id").references(() => ingestionRun.id),
    url: text("url").notNull(),
    status: fetchStatusEnum("status").notNull(),
    httpStatus: smallint("http_status"),
    errorMessage: text("error_message"),
    attempts: smallint("attempts").notNull().default(1),
    durationMs: integer("duration_ms"),
    snapshotId: uuid("snapshot_id").references(() => sourceSnapshot.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fetch_attempt_run_idx").on(t.ingestionRunId), index("fetch_attempt_source_idx").on(t.sourceId)],
);

// --- Entity resolution ----------------------------------------------------------------------

export const entityMention = pgTable(
  "entity_mention",
  {
    id: id(),
    snapshotId: uuid("snapshot_id").references(() => sourceSnapshot.id),
    ingestionRunId: uuid("ingestion_run_id").references(() => ingestionRun.id),
    /** Stable key of the mention within its source (e.g. PBHA program slug). */
    externalKey: text("external_key").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id),
    rawName: text("raw_name").notNull(),
    rawAcronym: text("raw_acronym"),
    payload: jsonb("payload").notNull().default({}),
    resolution: mentionResolutionEnum("resolution").notNull().default("pending"),
    resolvedClubId: uuid("resolved_club_id").references(() => club.id),
    matchScore: real("match_score"),
    matchSignals: jsonb("match_signals").notNull().default([]),
    matchExplanation: text("match_explanation"),
    matcherVersion: text("matcher_version"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("entity_mention_source_key").on(t.sourceId, t.externalKey),
    index("entity_mention_club_idx").on(t.resolvedClubId),
    index("entity_mention_resolution_idx").on(t.resolution),
  ],
);

export const mergeCandidate = pgTable(
  "merge_candidate",
  {
    id: id(),
    clubAId: uuid("club_a_id")
      .notNull()
      .references(() => club.id),
    clubBId: uuid("club_b_id")
      .notNull()
      .references(() => club.id),
    mentionId: uuid("mention_id").references(() => entityMention.id),
    score: real("score").notNull(),
    signals: jsonb("signals").notNull().default([]),
    status: mergeCandidateStatusEnum("status").notNull().default("proposed"),
    /** "likely_duplicate" (one plausible match) or "ambiguous" (several plausible). */
    reason: text("reason").notNull().default("likely_duplicate"),
    explanation: text("explanation"),
    matcherVersion: text("matcher_version").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("merge_candidate_pair_key").on(t.clubAId, t.clubBId),
    check("merge_candidate_ordered", sql`${t.clubAId} < ${t.clubBId}`),
  ],
);

// --- Recruiting (identity + projection) --------------------------------------------------------

export const recruitingCycle = pgTable(
  "recruiting_cycle",
  {
    id: id(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    termKey: text("term_key").notNull(), // "2026-fall"
    year: smallint("year").notNull(),
    season: text("season").notNull(),
    track: text("track").notNull().default("main"),
    // Projection columns (resolver-written). Status is computed at read time.
    opensAt: timestamp("opens_at", { withTimezone: true }),
    opensPrecision: text("opens_precision"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    deadlinePrecision: text("deadline_precision"),
    /** Original DateValue for faithful display (date-only stays date-only). */
    opensValue: jsonb("opens_value"),
    deadlineValue: jsonb("deadline_value"),
    processTypes: text("process_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    eligibleClasses: text("eligible_classes").array(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    statedStatus: text("stated_status"),
    applicationUrl: text("application_url"),
    applicants: integer("applicants"),
    admits: integer("admits"),
    fields: jsonb("fields").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("recruiting_cycle_key").on(t.clubId, t.termKey, t.track),
    index("recruiting_cycle_deadline_idx").on(t.deadlineAt),
    check("recruiting_cycle_term_format", sql`${t.termKey} ~ '^[0-9]{4}-(spring|summer|fall|winter)$'`),
  ],
);

// --- Claims ---------------------------------------------------------------------------------------

export const claim = pgTable(
  "claim",
  {
    id: id(),
    subjectType: subjectTypeEnum("subject_type").notNull(),
    /** Always set: the club the claim is (ultimately) about. */
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id),
    recruitingCycleId: uuid("recruiting_cycle_id").references(() => recruitingCycle.id),
    fieldKey: text("field_key").notNull(),
    value: jsonb("value").notNull(),
    normalizedValue: jsonb("normalized_value").notNull(),
    valueHash: text("value_hash").notNull(),
    assertionKind: assertionKindEnum("assertion_kind").notNull(),
    status: claimStatusEnum("status").notNull().default("active"),
    statusReason: text("status_reason"),
    termKey: text("term_key"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    asOfDate: date("as_of_date", { mode: "date" }),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Idempotency: the same assertion is one claim no matter how many times it is observed.
    unique("claim_identity_key")
      .on(t.subjectType, t.clubId, t.recruitingCycleId, t.fieldKey, t.valueHash, t.termKey, t.assertionKind)
      .nullsNotDistinct(),
    index("claim_club_field_idx").on(t.clubId, t.fieldKey),
    index("claim_cycle_idx").on(t.recruitingCycleId),
    check(
      "claim_subject_consistency",
      sql`(${t.subjectType} = 'recruiting_cycle') = (${t.recruitingCycleId} IS NOT NULL)`,
    ),
    check(
      "claim_validity_order",
      sql`${t.validUntil} IS NULL OR ${t.validFrom} IS NULL OR ${t.validFrom} <= ${t.validUntil}`,
    ),
  ],
);

export const studentSubmission = pgTable(
  "student_submission",
  {
    id: id(),
    kind: text("kind").notNull(), // edit_suggestion | link | deadline | inactive_report | staleness_vote
    clubId: uuid("club_id").references(() => club.id),
    payload: jsonb("payload").notNull(),
    evidenceUrl: text("evidence_url"),
    /** Opaque reference; never an email or name. */
    submitterRef: text("submitter_ref"),
    status: submissionStatusEnum("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resultingClaimIds: uuid("resulting_claim_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [index("student_submission_status_idx").on(t.status), index("student_submission_club_idx").on(t.clubId)],
);

/**
 * One proposed field value inside a submission (ADR 0035): parsed from the form's template
 * lines on import, or added by the editor. Each is accepted or rejected on its own; the
 * submission's raw payload is never edited.
 */
export const submissionProposal = pgTable(
  "submission_proposal",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => studentSubmission.id),
    /** 1-based order within the submission; reviewers refer to proposals by it ("#2"). */
    position: integer("position").notNull(),
    /** Registry field key, or "duplicate_of" (accepting proposes a merge for review). */
    fieldKey: text("field_key").notNull(),
    /** Template line the value came from ("Dues"), or "editor". */
    label: text("label").notNull(),
    rawText: text("raw_text").notNull(),
    /** Parsed value; null when the editor must supply one. */
    value: jsonb("value"),
    termKey: text("term_key"),
    parseNote: text("parse_note"),
    origin: text("origin").notNull().default("form"), // form | editor
    status: proposalStatusEnum("status").notNull().default("pending"),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The community claim, plus the sourced claim when the evidence link corroborated it. */
    resultingClaimIds: uuid("resulting_claim_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** What fetching the submission's evidence link showed: {url, status, snapshotId, quote}. */
    evidenceCheck: jsonb("evidence_check"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("submission_proposal_position_key").on(t.submissionId, t.position),
    check("submission_proposal_origin", sql`${t.origin} IN ('form', 'editor')`),
    check("submission_proposal_decided", sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL)`),
  ],
);

/**
 * Anonymous comp-outcome report (CLAUDE.md §14, ADR 0035). No link to a user or submitter
 * by design; dates are kept to the day. Not displayed until M6; aggregation rules live in
 * @hci/core (comp-reports.ts).
 */
export const compReport = pgTable(
  "comp_report",
  {
    id: id(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id),
    recruitingCycleId: uuid("recruiting_cycle_id").references(() => recruitingCycle.id),
    termKey: text("term_key").notNull(),
    track: text("track").notNull().default("main"),
    classYear: text("class_year"),
    applied: boolean("applied").notNull(),
    furthestStage: text("furthest_stage"),
    accepted: boolean("accepted"),
    approxApplicants: integer("approx_applicants"),
    approxCohortSize: integer("approx_cohort_size"),
    hoursSpent: real("hours_spent"),
    /** Moderation only; never displayed or exported. */
    notes: text("notes"),
    status: compReportStatusEnum("status").notNull().default("pending"),
    reportedOn: date("reported_on", { mode: "string" }).notNull(),
  },
  (t) => [
    index("comp_report_cycle_idx").on(t.clubId, t.termKey, t.track),
    check(
      "comp_report_class_year",
      sql`${t.classYear} IS NULL OR ${t.classYear} IN ('first_year', 'sophomore', 'junior', 'senior', 'graduate')`,
    ),
    check(
      "comp_report_outcome_needs_application",
      sql`${t.applied} OR (${t.accepted} IS NULL AND ${t.furthestStage} IS NULL)`,
    ),
    check("comp_report_counts", sql`coalesce(${t.approxApplicants}, 1) > 0 AND coalesce(${t.approxCohortSize}, 1) > 0`),
  ],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: id(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claim.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id),
    snapshotId: uuid("snapshot_id").references(() => sourceSnapshot.id),
    submissionId: uuid("submission_id").references(() => studentSubmission.id),
    ingestionRunId: uuid("ingestion_run_id").references(() => ingestionRun.id),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    evidenceQuote: text("evidence_quote"),
    evidenceLocator: jsonb("evidence_locator"),
    extractionMethod: text("extraction_method").notNull(),
    extractorName: text("extractor_name").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    llmModel: text("llm_model"),
    promptVersion: text("prompt_version"),
    confidence: real("confidence").notNull(),
    isDirect: boolean("is_direct").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("claim_evidence_observation_key")
      .on(t.claimId, t.sourceId, t.snapshotId, t.extractorName, t.extractorVersion)
      .nullsNotDistinct(),
    index("claim_evidence_claim_idx").on(t.claimId),
    index("claim_evidence_snapshot_idx").on(t.snapshotId),
    check("claim_evidence_confidence_range", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check(
      "claim_evidence_has_origin",
      sql`${t.snapshotId} IS NOT NULL OR ${t.submissionId} IS NOT NULL OR ${t.extractionMethod} IN ('manual', 'fixture')`,
    ),
    check(
      "claim_evidence_llm_metadata",
      sql`${t.extractionMethod} <> 'llm' OR (${t.llmModel} IS NOT NULL AND ${t.promptVersion} IS NOT NULL AND ${t.evidenceQuote} IS NOT NULL)`,
    ),
  ],
);

/**
 * Every (snapshot, extractor version) pass, even one that produced nothing. Lets
 * `retract-unreproduced` see that a newer version re-read a page and found no claim there
 * (ADR 0039; evidence rows alone only record passes that produced something).
 */
export const snapshotExtraction = pgTable(
  "snapshot_extraction",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => sourceSnapshot.id, { onDelete: "cascade" }),
    extractorName: text("extractor_name").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    claims: integer("claims").notNull().default(0),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.extractorName, t.extractorVersion] })],
);

export const editorialDecision = pgTable(
  "editorial_decision",
  {
    id: id(),
    actor: text("actor").notNull(),
    action: text("action").notNull(), // pin_claim | reject_claim | confirm_merge | reject_merge | hide_club | ...
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("editorial_decision_target_idx").on(t.targetType, t.targetId)],
);

// --- Projections -----------------------------------------------------------------------------------

export const clubAlias = pgTable(
  "club_alias",
  {
    id: id(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    kind: text("kind").notNull(), // alternate | former | abbreviation | acronym
    claimId: uuid("claim_id").references(() => claim.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("club_alias_key").on(t.clubId, t.normalizedAlias),
    index("club_alias_normalized_idx").on(t.normalizedAlias),
  ],
);

export const clubCategory = pgTable(
  "club_category",
  {
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    claimId: uuid("claim_id").references(() => claim.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.clubId, t.categoryId] }), index("club_category_category_idx").on(t.categoryId)],
);

export const clubLink = pgTable(
  "club_link",
  {
    id: id(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    handle: text("handle"),
    label: text("label"),
    status: text("status").notNull(), // verified | probable | unverified | rejected
    confidence: real("confidence").notNull().default(0),
    /** Source types that reported this link, best first. */
    discoveredVia: text("discovered_via")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    signals: text("signals")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    claimId: uuid("claim_id").references(() => claim.id, { onDelete: "set null" }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("club_link_key").on(t.clubId, t.normalizedUrl),
    index("club_link_kind_idx").on(t.kind),
    check("club_link_status", sql`${t.status} IN ('verified', 'probable', 'unverified', 'rejected')`),
  ],
);

export const membershipEstimate = pgTable(
  "membership_estimate",
  {
    id: id(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claim.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // exact | range
    count: integer("count"),
    min: integer("min"),
    max: integer("max"),
    asOf: timestamp("as_of", { withTimezone: true }),
    termKey: text("term_key"),
    badge: text("badge").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [
    uniqueIndex("membership_estimate_claim_key").on(t.claimId),
    index("membership_estimate_club_idx").on(t.clubId),
    check(
      "membership_estimate_shape",
      sql`(${t.kind} = 'exact' AND ${t.count} IS NOT NULL) OR (${t.kind} = 'range' AND (${t.min} IS NOT NULL OR ${t.max} IS NOT NULL))`,
    ),
  ],
);

export const recruitingStage = pgTable(
  "recruiting_stage",
  {
    id: id(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitingCycle.id, { onDelete: "cascade" }),
    ordinal: smallint("ordinal").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    startsValue: jsonb("starts_value"),
    endsValue: jsonb("ends_value"),
  },
  (t) => [uniqueIndex("recruiting_stage_key").on(t.cycleId, t.ordinal)],
);

export const clubSearchDocument = pgTable(
  "club_search_document",
  {
    clubId: uuid("club_id")
      .primaryKey()
      .references(() => club.id, { onDelete: "cascade" }),
    /** Normalized names: canonical + acronym + aliases, space-joined. For trigram matching. */
    names: text("names").notNull(),
    acronyms: text("acronyms")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    document: tsvector("document").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("club_search_document_fts_idx").using("gin", t.document),
    index("club_search_document_names_trgm_idx").using("gin", t.names.op("gin_trgm_ops")),
    index("club_search_document_acronyms_idx").using("gin", t.acronyms),
  ],
);

/**
 * Cache of semantic (LLM) extraction results keyed by input text hash + extractor/prompt
 * version + model, so reruns are free and deterministic (CLAUDE.md §11.3). Also the cost ledger.
 */
export const extractionCache = pgTable(
  "extraction_cache",
  {
    id: id(),
    textSha256: text("text_sha256").notNull(),
    extractor: text("extractor").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    snapshotId: uuid("snapshot_id").references(() => sourceSnapshot.id),
    status: text("status").notNull(), // ok | invalid | error
    output: jsonb("output"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    attempts: smallint("attempts").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("extraction_cache_key").on(t.textSha256, t.extractor, t.promptVersion, t.provider, t.model)],
);
