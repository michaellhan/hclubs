ALTER TYPE "public"."mention_resolution" ADD VALUE 'ambiguous' BEFORE 'new';--> statement-breakpoint
ALTER TYPE "public"."merge_candidate_status" ADD VALUE 'undone';--> statement-breakpoint
CREATE TABLE "extraction_cache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text_sha256" text NOT NULL,
	"extractor" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"snapshot_id" uuid,
	"status" text NOT NULL,
	"output" jsonb,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" real,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_link" DROP CONSTRAINT "club_link_status";--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "eligible_classes" text[];--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "activity_confidence" real;--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "activity_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "club" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "club_link" ADD COLUMN "confidence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "club_link" ADD COLUMN "discovered_via" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "club_link" ADD COLUMN "signals" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_mention" ADD COLUMN "match_explanation" text;--> statement-breakpoint
ALTER TABLE "merge_candidate" ADD COLUMN "reason" text DEFAULT 'likely_duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "merge_candidate" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "recruiting_cycle" ADD COLUMN "eligible_classes" text[];--> statement-breakpoint
ALTER TABLE "recruiting_cycle" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "page_role" text;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "needs_browser" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_cache" ADD CONSTRAINT "extraction_cache_snapshot_id_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_cache_key" ON "extraction_cache" USING btree ("text_sha256","extractor","prompt_version","provider","model");--> statement-breakpoint
-- Projection rows from M1 used "candidate"; the resolver rebuilds them anyway.
UPDATE "club_link" SET "status" = 'unverified' WHERE "status" = 'candidate';--> statement-breakpoint
ALTER TABLE "club_link" ADD CONSTRAINT "club_link_status" CHECK ("club_link"."status" IN ('verified', 'probable', 'unverified', 'rejected'));