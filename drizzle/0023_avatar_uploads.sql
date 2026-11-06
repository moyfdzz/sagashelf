ALTER TABLE "users" ADD COLUMN "avatar_uploads_day" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_uploads_count" smallint DEFAULT 0 NOT NULL;