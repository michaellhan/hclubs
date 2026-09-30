CREATE TYPE "public"."assertion_kind" AS ENUM('stated', 'inferred', 'computed', 'user_reported', 'editorial');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('active', 'superseded', 'retracted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."data_origin" AS ENUM('ingested', 'fixture', 'editorial');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('ok', 'not_modified', 'http_error', 'network_error', 'robots_disallowed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."mention_resolution" AS ENUM('definite', 'probable', 'new', 'pending', 'manual');--> statement-breakpoint
CREATE TYPE "public"."merge_candidate_status" AS ENUM('proposed', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."record_state" AS ENUM('active', 'merged', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('club', 'recruiting_cycle');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'accepted', 'rejected', 'spam');--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"club_id" uuid NOT NULL,
	"recruiting_cycle_id" uuid,
	"field_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"normalized_value" jsonb NOT NULL,
	"value_hash" text NOT NULL,
	"assertion_kind" "assertion_kind" NOT NULL,
	"status" "claim_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"term_key" text,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"as_of_date" date,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_identity_key" UNIQUE NULLS NOT DISTINCT("subject_type","club_id","recruiting_cycle_id","field_key","value_hash","term_key","assertion_kind"),
	CONSTRAINT "claim_subject_consistency" CHECK (("claim"."subject_type" = 'recruiting_cycle') = ("claim"."recruiting_cycle_id" IS NOT NULL)),
	CONSTRAINT "claim_validity_order" CHECK ("claim"."valid_until" IS NULL OR "claim"."valid_from" IS NULL OR "claim"."valid_from" <= "claim"."valid_until")
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"submission_id" uuid,
	"ingestion_run_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence_quote" text,
	"evidence_locator" jsonb,
	"extraction_method" text NOT NULL,
	"extractor_name" text NOT NULL,
	"extractor_version" text NOT NULL,
	"llm_model" text,
	"prompt_version" text,
	"confidence" real NOT NULL,
	"is_direct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_evidence_observation_key" UNIQUE NULLS NOT DISTINCT("claim_id","source_id","snapshot_id","extractor_name","extractor_version"),
	CONSTRAINT "claim_evidence_confidence_range" CHECK ("claim_evidence"."confidence" >= 0 AND "claim_evidence"."confidence" <= 1),
	CONSTRAINT "claim_evidence_has_origin" CHECK ("claim_evidence"."snapshot_id" IS NOT NULL OR "claim_evidence"."submission_id" IS NOT NULL OR "claim_evidence"."extraction_method" IN ('manual', 'fixture')),
	CONSTRAINT "claim_evidence_llm_metadata" CHECK ("claim_evidence"."extraction_method" <> 'llm' OR ("claim_evidence"."llm_model" IS NOT NULL AND "claim_evidence"."prompt_version" IS NOT NULL AND "claim_evidence"."evidence_quote" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "club" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"canonical_name" text NOT NULL,
	"record_state" "record_state" DEFAULT 'active' NOT NULL,
	"data_origin" "data_origin" DEFAULT 'ingested' NOT NULL,
	"merged_into_club_id" uuid,
	"acronym" text,
	"short_description" text,
	"long_description" text,
	"org_type" text,
	"recognition_status" text DEFAULT 'unknown' NOT NULL,
	"activity_status" text DEFAULT 'unknown' NOT NULL,
	"affiliation_scope" text DEFAULT 'unknown' NOT NULL,
	"join_modes" text[] DEFAULT '{}'::text[] NOT NULL,
	"freshmen_eligible" boolean,
	"hours_per_week_min" real,
	"hours_per_week_max" real,
	"member_count_min" integer,
	"member_count_max" integer,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completeness" real DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"conflict_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_observed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolver_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_merged_consistency" CHECK (("club"."record_state" = 'merged') = ("club"."merged_into_club_id" IS NOT NULL)),
	CONSTRAINT "club_slug_format" CHECK ("club"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "club_alias" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"kind" text NOT NULL,
	"claim_id" uuid
);
--> statement-breakpoint
CREATE TABLE "club_category" (
	"club_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"claim_id" uuid,
	CONSTRAINT "club_category_club_id_category_id_pk" PRIMARY KEY("club_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "club_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"handle" text,
	"label" text,
	"status" text NOT NULL,
	"claim_id" uuid,
	"last_observed_at" timestamp with time zone,
	CONSTRAINT "club_link_status" CHECK ("club_link"."status" IN ('verified', 'candidate', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "club_search_document" (
	"club_id" uuid PRIMARY KEY NOT NULL,
	"names" text NOT NULL,
	"acronyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"document" "tsvector" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_mention" (
	"id" uuid PRIMARY KEY NOT NULL,
	"snapshot_id" uuid,
	"ingestion_run_id" uuid,
	"external_key" text NOT NULL,
	"source_id" uuid NOT NULL,
	"raw_name" text NOT NULL,
	"raw_acronym" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" "mention_resolution" DEFAULT 'pending' NOT NULL,
	"resolved_club_id" uuid,
	"match_score" real,
	"match_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matcher_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid,
	"ingestion_run_id" uuid,
	"url" text NOT NULL,
	"status" "fetch_status" NOT NULL,
	"http_status" smallint,
	"error_message" text,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"snapshot_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"adapter" text,
	"adapter_version" text,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_summary" text,
	"git_sha" text
);
--> statement-breakpoint
CREATE TABLE "membership_estimate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"count" integer,
	"min" integer,
	"max" integer,
	"as_of" timestamp with time zone,
	"term_key" text,
	"badge" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "membership_estimate_shape" CHECK (("membership_estimate"."kind" = 'exact' AND "membership_estimate"."count" IS NOT NULL) OR ("membership_estimate"."kind" = 'range' AND ("membership_estimate"."min" IS NOT NULL OR "membership_estimate"."max" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "merge_candidate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_a_id" uuid NOT NULL,
	"club_b_id" uuid NOT NULL,
	"mention_id" uuid,
	"score" real NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "merge_candidate_status" DEFAULT 'proposed' NOT NULL,
	"matcher_version" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_candidate_ordered" CHECK ("merge_candidate"."club_a_id" < "merge_candidate"."club_b_id")
);
--> statement-breakpoint
CREATE TABLE "recruiting_cycle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	"year" smallint NOT NULL,
	"season" text NOT NULL,
	"track" text DEFAULT 'main' NOT NULL,
	"opens_at" timestamp with time zone,
	"opens_precision" text,
	"deadline_at" timestamp with time zone,
	"deadline_precision" text,
	"opens_value" jsonb,
	"deadline_value" jsonb,
	"process_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"stated_status" text,
	"application_url" text,
	"applicants" integer,
	"admits" integer,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruiting_cycle_term_format" CHECK ("recruiting_cycle"."term_key" ~ '^[0-9]{4}-(spring|summer|fall|winter)$')
);
--> statement-breakpoint
CREATE TABLE "recruiting_stage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cycle_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"starts_value" jsonb,
	"ends_value" jsonb
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"domain" text NOT NULL,
	"source_type" text NOT NULL,
	"trust_tier" smallint NOT NULL,
	"title" text,
	"owner_club_id" uuid,
	"publisher" text,
	"adapter" text,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"recheck_interval_hours" integer,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_trust_tier_range" CHECK ("source"."trust_tier" BETWEEN 0 AND 9)
);
--> statement-breakpoint
CREATE TABLE "source_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"ingestion_run_id" uuid,
	"fetched_at" timestamp with time zone NOT NULL,
	"final_url" text NOT NULL,
	"http_status" smallint,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"content_sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"extracted_text" text,
	"fetch_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_submission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"club_id" uuid,
	"payload" jsonb NOT NULL,
	"evidence_url" text,
	"submitter_ref" text,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"resulting_claim_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_recruiting_cycle_id_recruiting_cycle_id_fk" FOREIGN KEY ("recruiting_cycle_id") REFERENCES "public"."recruiting_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_snapshot_id_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_submission_id_student_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."student_submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_ingestion_run_id_ingestion_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_merged_into_club_id_club_id_fk" FOREIGN KEY ("merged_into_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_alias" ADD CONSTRAINT "club_alias_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_alias" ADD CONSTRAINT "club_alias_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_category" ADD CONSTRAINT "club_category_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_category" ADD CONSTRAINT "club_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_category" ADD CONSTRAINT "club_category_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_link" ADD CONSTRAINT "club_link_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_link" ADD CONSTRAINT "club_link_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_search_document" ADD CONSTRAINT "club_search_document_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_slug_history" ADD CONSTRAINT "club_slug_history_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD CONSTRAINT "entity_mention_snapshot_id_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD CONSTRAINT "entity_mention_ingestion_run_id_ingestion_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD CONSTRAINT "entity_mention_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD CONSTRAINT "entity_mention_resolved_club_id_club_id_fk" FOREIGN KEY ("resolved_club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempt" ADD CONSTRAINT "fetch_attempt_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempt" ADD CONSTRAINT "fetch_attempt_ingestion_run_id_ingestion_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempt" ADD CONSTRAINT "fetch_attempt_snapshot_id_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_estimate" ADD CONSTRAINT "membership_estimate_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_estimate" ADD CONSTRAINT "membership_estimate_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidate" ADD CONSTRAINT "merge_candidate_club_a_id_club_id_fk" FOREIGN KEY ("club_a_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidate" ADD CONSTRAINT "merge_candidate_club_b_id_club_id_fk" FOREIGN KEY ("club_b_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_candidate" ADD CONSTRAINT "merge_candidate_mention_id_entity_mention_id_fk" FOREIGN KEY ("mention_id") REFERENCES "public"."entity_mention"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiting_cycle" ADD CONSTRAINT "recruiting_cycle_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiting_stage" ADD CONSTRAINT "recruiting_stage_cycle_id_recruiting_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."recruiting_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_owner_club_id_club_id_fk" FOREIGN KEY ("owner_club_id") REFERENCES "public"."club"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshot" ADD CONSTRAINT "source_snapshot_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshot" ADD CONSTRAINT "source_snapshot_ingestion_run_id_ingestion_run_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_submission" ADD CONSTRAINT "student_submission_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_slug_key" ON "category" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "category_parent_idx" ON "category" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "claim_club_field_idx" ON "claim" USING btree ("club_id","field_key");--> statement-breakpoint
CREATE INDEX "claim_cycle_idx" ON "claim" USING btree ("recruiting_cycle_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_snapshot_idx" ON "claim_evidence" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_slug_key" ON "club" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "club_record_state_idx" ON "club" USING btree ("record_state");--> statement-breakpoint
CREATE INDEX "club_join_modes_idx" ON "club" USING gin ("join_modes");--> statement-breakpoint
CREATE UNIQUE INDEX "club_alias_key" ON "club_alias" USING btree ("club_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "club_alias_normalized_idx" ON "club_alias" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "club_category_category_idx" ON "club_category" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_link_key" ON "club_link" USING btree ("club_id","normalized_url");--> statement-breakpoint
CREATE INDEX "club_link_kind_idx" ON "club_link" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "club_search_document_fts_idx" ON "club_search_document" USING gin ("document");--> statement-breakpoint
CREATE INDEX "club_search_document_names_trgm_idx" ON "club_search_document" USING gin ("names" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "club_search_document_acronyms_idx" ON "club_search_document" USING gin ("acronyms");--> statement-breakpoint
CREATE INDEX "club_slug_history_club_idx" ON "club_slug_history" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "editorial_decision_target_idx" ON "editorial_decision" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_mention_source_key" ON "entity_mention" USING btree ("source_id","external_key");--> statement-breakpoint
CREATE INDEX "entity_mention_club_idx" ON "entity_mention" USING btree ("resolved_club_id");--> statement-breakpoint
CREATE INDEX "entity_mention_resolution_idx" ON "entity_mention" USING btree ("resolution");--> statement-breakpoint
CREATE INDEX "fetch_attempt_run_idx" ON "fetch_attempt" USING btree ("ingestion_run_id");--> statement-breakpoint
CREATE INDEX "fetch_attempt_source_idx" ON "fetch_attempt" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ingestion_run_started_idx" ON "ingestion_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ingestion_run_adapter_idx" ON "ingestion_run" USING btree ("adapter");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_estimate_claim_key" ON "membership_estimate" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "membership_estimate_club_idx" ON "membership_estimate" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_candidate_pair_key" ON "merge_candidate" USING btree ("club_a_id","club_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruiting_cycle_key" ON "recruiting_cycle" USING btree ("club_id","term_key","track");--> statement-breakpoint
CREATE INDEX "recruiting_cycle_deadline_idx" ON "recruiting_cycle" USING btree ("deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recruiting_stage_key" ON "recruiting_stage" USING btree ("cycle_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "source_normalized_url_key" ON "source" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "source_domain_idx" ON "source" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "source_owner_club_idx" ON "source" USING btree ("owner_club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshot_content_key" ON "source_snapshot" USING btree ("source_id","content_sha256");--> statement-breakpoint
CREATE INDEX "source_snapshot_source_fetched_idx" ON "source_snapshot" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "student_submission_status_idx" ON "student_submission" USING btree ("status");--> statement-breakpoint
CREATE INDEX "student_submission_club_idx" ON "student_submission" USING btree ("club_id");