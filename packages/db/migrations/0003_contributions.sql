CREATE TYPE "public"."comp_report_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."submission_status" ADD VALUE 'partially_accepted' BEFORE 'rejected';--> statement-breakpoint
CREATE TABLE "comp_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"recruiting_cycle_id" uuid,
	"term_key" text NOT NULL,
	"track" text DEFAULT 'main' NOT NULL,
	"class_year" text,
	"applied" boolean NOT NULL,
	"furthest_stage" text,
	"accepted" boolean,
	"approx_applicants" integer,
	"approx_cohort_size" integer,
	"hours_spent" real,
	"notes" text,
	"status" "comp_report_status" DEFAULT 'pending' NOT NULL,
	"reported_on" date NOT NULL,
	CONSTRAINT "comp_report_class_year" CHECK ("comp_report"."class_year" IS NULL OR "comp_report"."class_year" IN ('first_year', 'sophomore', 'junior', 'senior', 'graduate')),
	CONSTRAINT "comp_report_outcome_needs_application" CHECK ("comp_report"."applied" OR ("comp_report"."accepted" IS NULL AND "comp_report"."furthest_stage" IS NULL)),
	CONSTRAINT "comp_report_counts" CHECK (coalesce("comp_report"."approx_applicants", 1) > 0 AND coalesce("comp_report"."approx_cohort_size", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "submission_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"raw_text" text NOT NULL,
	"value" jsonb,
	"term_key" text,
	"parse_note" text,
	"origin" text DEFAULT 'form' NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"resulting_claim_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"evidence_check" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_proposal_origin" CHECK ("submission_proposal"."origin" IN ('form', 'editor')),
	CONSTRAINT "submission_proposal_decided" CHECK (("submission_proposal"."status" = 'pending') = ("submission_proposal"."decided_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "comp_report" ADD CONSTRAINT "comp_report_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_report" ADD CONSTRAINT "comp_report_recruiting_cycle_id_recruiting_cycle_id_fk" FOREIGN KEY ("recruiting_cycle_id") REFERENCES "public"."recruiting_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_proposal" ADD CONSTRAINT "submission_proposal_submission_id_student_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."student_submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comp_report_cycle_idx" ON "comp_report" USING btree ("club_id","term_key","track");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_proposal_position_key" ON "submission_proposal" USING btree ("submission_id","position");