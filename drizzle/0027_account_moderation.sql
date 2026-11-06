ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_before_ban" "privacy_level";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('episode.aired', 'report.created', 'moderation.warning'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_moderation_status_check" CHECK ("users"."moderation_status" in ('active', 'suspended', 'banned'));