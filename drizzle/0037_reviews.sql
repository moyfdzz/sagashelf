ALTER TYPE "public"."activity_type" ADD VALUE 'reviewed';--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"body" text NOT NULL,
	"fingerprint" text NOT NULL,
	"spoiler" boolean DEFAULT false NOT NULL,
	"visibility" "privacy_level" NOT NULL,
	"activity_id" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_activity_id_unique" UNIQUE("activity_id"),
	CONSTRAINT "reviews_user_media_unique" UNIQUE("user_id","media_id"),
	CONSTRAINT "reviews_body_length_check" CHECK (char_length("reviews"."body") BETWEEN 500 AND 5000),
	CONSTRAINT "reviews_fingerprint_check" CHECK ("reviews"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reviews_hour_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reviews_hour_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_user_created_idx" ON "reviews" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_media_created_idx" ON "reviews" USING btree ("media_id","created_at" DESC NULLS LAST);