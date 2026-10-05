CREATE TABLE "image_probe" (
	"url" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"content_type" text,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"format" text,
	"stats" jsonb,
	"error" text,
	"measure_version" text NOT NULL,
	CONSTRAINT "image_probe_status" CHECK ("image_probe"."status" IN ('ok', 'fetch_error', 'decode_error'))
);
