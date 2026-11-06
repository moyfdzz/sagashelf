ALTER TYPE "public"."report_reason" ADD VALUE 'sexual_content';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'sexual_minors';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'other_person';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'violent';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'impersonation';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'hate';--> statement-breakpoint
ALTER TYPE "public"."report_target_type" ADD VALUE 'picture';--> statement-breakpoint
CREATE TABLE "picture_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"result" text NOT NULL,
	"scores" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picture_uploads_result_check" CHECK ("picture_uploads"."result" in ('allowed', 'rejected', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_reporter_target_unique";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "picture_url" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "picture_uploads" ADD CONSTRAINT "picture_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "picture_uploads_user_idx" ON "picture_uploads" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "picture_uploads_created_idx" ON "picture_uploads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_target_active_unique" ON "reports" USING btree ("reporter_id","target_type","target_id",coalesce("picture_url", '')) WHERE "reports"."cancelled_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('episode.aired', 'report.created'));