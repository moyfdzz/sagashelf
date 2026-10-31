ALTER TABLE "sagas" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "sagas" ADD COLUMN "origin" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "sagas" ADD COLUMN "franchise_qid" text;--> statement-breakpoint
ALTER TABLE "sagas" ADD CONSTRAINT "sagas_franchise_qid_unique" UNIQUE("franchise_qid");--> statement-breakpoint
ALTER TABLE "sagas" ADD CONSTRAINT "sagas_status_check" CHECK ("sagas"."status" in ('draft', 'published'));--> statement-breakpoint
ALTER TABLE "sagas" ADD CONSTRAINT "sagas_origin_check" CHECK ("sagas"."origin" in ('file', 'admin', 'wikidata'));