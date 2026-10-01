CREATE TABLE "snapshot_extraction" (
	"snapshot_id" uuid NOT NULL,
	"extractor_name" text NOT NULL,
	"extractor_version" text NOT NULL,
	"claims" integer DEFAULT 0 NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_extraction_snapshot_id_extractor_name_extractor_version_pk" PRIMARY KEY("snapshot_id","extractor_name","extractor_version")
);
--> statement-breakpoint
ALTER TABLE "snapshot_extraction" ADD CONSTRAINT "snapshot_extraction_snapshot_id_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE cascade ON UPDATE no action;