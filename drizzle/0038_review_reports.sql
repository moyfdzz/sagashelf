ALTER TYPE "public"."report_reason" ADD VALUE 'spoiler';--> statement-breakpoint
ALTER TYPE "public"."report_target_type" ADD VALUE 'review';--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
DROP INDEX "reports_reporter_target_active_unique";--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "spoiler_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_target_active_unique" ON "reports" USING btree ("reporter_id","target_type","target_id",coalesce("picture_url", ''),coalesce("review_id"::text, '')) WHERE "reports"."cancelled_at" is null and "reports"."status" in ('open', 'reviewing');--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_review_id_check" CHECK (("reports"."target_type"::text = 'review') = ("reports"."review_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('episode.aired', 'report.created', 'moderation.warning', 'moderation.review_removed', 'moderation.review_spoiler', 'contact.created', 'import.finished'));