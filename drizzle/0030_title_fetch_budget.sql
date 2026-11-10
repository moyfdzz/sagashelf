ALTER TABLE "users" ADD COLUMN "title_fetches_day" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title_fetches_count" smallint DEFAULT 0 NOT NULL;