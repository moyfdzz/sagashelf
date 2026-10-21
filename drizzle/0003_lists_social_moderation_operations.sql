CREATE TYPE "public"."moderation_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'inappropriate', 'copyright', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('user', 'custom_entry', 'list', 'activity');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_kind" AS ENUM('discord', 'generic');--> statement-breakpoint
CREATE TYPE "public"."webhook_provider" AS ENUM('clerk', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('started', 'progressed', 'completed', 'dropped', 'rated', 'list_created');--> statement-breakpoint
CREATE TABLE "custom_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"visibility" "privacy_level" DEFAULT 'private' NOT NULL,
	"moderation_state" "moderation_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_entries_media_id_unique" UNIQUE("media_id")
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"list_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_list_id_media_id_pk" PRIMARY KEY("list_id","media_id"),
	CONSTRAINT "list_items_note_length_check" CHECK (char_length("list_items"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"visibility" "privacy_level" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_owner_title_unique" UNIQUE("owner_id","title"),
	CONSTRAINT "lists_title_length_check" CHECK (char_length("lists"."title") between 1 and 100),
	CONSTRAINT "lists_description_length_check" CHECK (char_length("lists"."description") <= 500)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reporter_id" uuid,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reporter_target_unique" UNIQUE("reporter_id","target_type","target_id"),
	CONSTRAINT "reports_details_length_check" CHECK (char_length("reports"."details") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "outbox_attempts_check" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "processed_webhooks" (
	"provider" "webhook_provider" NOT NULL,
	"event_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhooks_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"outbox_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_outbox_endpoint_attempt_unique" UNIQUE("outbox_id","endpoint_id","attempt"),
	CONSTRAINT "webhook_deliveries_attempt_check" CHECK ("webhook_deliveries"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "webhook_kind" NOT NULL,
	"url" text NOT NULL,
	"event_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_encrypted" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_https_check" CHECK ("webhook_endpoints"."url" like 'https://%'),
	CONSTRAINT "webhook_endpoints_failure_count_check" CHECK ("webhook_endpoints"."failure_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"media_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" "privacy_level" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self_check" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self_check" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"user_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_user_id_activity_id_pk" PRIMARY KEY("user_id","activity_id")
);
--> statement-breakpoint
ALTER TABLE "custom_entries" ADD CONSTRAINT "custom_entries_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_entries" ADD CONSTRAINT "custom_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_entries_owner_idx" ON "custom_entries" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "custom_entries_pending_idx" ON "custom_entries" USING btree ("created_at") WHERE "custom_entries"."moderation_state" = 'pending';--> statement-breakpoint
CREATE INDEX "list_items_media_idx" ON "list_items" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "lists_public_idx" ON "lists" USING btree ("created_at") WHERE "lists"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("created_at") WHERE "reports"."status" in ('open', 'reviewing');--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("next_attempt_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_created_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_endpoints_user_idx" ON "webhook_endpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_actor_created_idx" ON "activity" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_public_feed_idx" ON "activity" USING btree ("created_at" DESC NULLS LAST) WHERE "activity"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "follows_followee_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "likes_activity_idx" ON "likes" USING btree ("activity_id");