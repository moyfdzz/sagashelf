CREATE TYPE "public"."external_provider" AS ENUM('tmdb', 'tvmaze', 'wikidata', 'open_library', 'google_books', 'mangadex', 'isbn');--> statement-breakpoint
CREATE TYPE "public"."library_status" AS ENUM('planned', 'in_progress', 'completed', 'paused', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('upcoming', 'ongoing', 'finished', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('anime', 'movie', 'series', 'book', 'manga', 'custom');--> statement-breakpoint
CREATE TYPE "public"."part_kind" AS ENUM('season', 'episode', 'volume', 'chapter');--> statement-breakpoint
CREATE TYPE "public"."privacy_level" AS ENUM('public', 'friends', 'private');--> statement-breakpoint
CREATE TYPE "public"."saga_role" AS ENUM('original', 'adaptation', 'sequel', 'prequel', 'spin_off', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TABLE "library_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"status" "library_status" DEFAULT 'planned' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"score" smallint,
	"started_at" date,
	"finished_at" date,
	"rewatch_count" smallint DEFAULT 0 NOT NULL,
	"notes" text,
	"visibility" "privacy_level" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_entries_user_media_unique" UNIQUE("user_id","media_id"),
	CONSTRAINT "library_entries_progress_check" CHECK ("library_entries"."progress" >= 0),
	CONSTRAINT "library_entries_score_check" CHECK ("library_entries"."score" is null or "library_entries"."score" between 1 and 10),
	CONSTRAINT "library_entries_rewatch_check" CHECK ("library_entries"."rewatch_count" >= 0),
	CONSTRAINT "library_entries_dates_check" CHECK ("library_entries"."started_at" is null or "library_entries"."finished_at" is null or "library_entries"."finished_at" >= "library_entries"."started_at"),
	CONSTRAINT "library_entries_notes_length_check" CHECK (char_length("library_entries"."notes") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "media_external_ids" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"provider" "external_provider" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_external_ids_provider_external_id_unique" UNIQUE("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" "media_type" NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"year" smallint,
	"synopsis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_url" text,
	"status" "media_status" DEFAULT 'unknown' NOT NULL,
	"popularity" real DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(coalesce(title, '') || ' ' || coalesce(original_title, '')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_items_year_check" CHECK ("media_items"."year" is null or "media_items"."year" between 1000 and 2200)
);
--> statement-breakpoint
CREATE TABLE "media_parts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"kind" "part_kind" NOT NULL,
	"parent_id" uuid,
	"number" integer NOT NULL,
	"title" text,
	"air_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_parts_media_kind_parent_number_unique" UNIQUE NULLS NOT DISTINCT("media_id","kind","parent_id","number"),
	CONSTRAINT "media_parts_number_check" CHECK ("media_parts"."number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saga_members" (
	"saga_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" "saga_role" DEFAULT 'other' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saga_members_saga_id_media_id_pk" PRIMARY KEY("saga_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "sagas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sagas_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"clerk_id" text NOT NULL,
	"username" "citext" NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"bio" text,
	"locale" text DEFAULT 'es' NOT NULL,
	"privacy" "privacy_level" DEFAULT 'public' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"email_canonical" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_canonical_unique" UNIQUE("email_canonical"),
	CONSTRAINT "users_username_length_check" CHECK (char_length("users"."username"::text) between 3 and 30),
	CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('es', 'en')),
	CONSTRAINT "users_bio_length_check" CHECK (char_length("users"."bio") <= 500)
);
--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_external_ids" ADD CONSTRAINT "media_external_ids_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_parts" ADD CONSTRAINT "media_parts_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_parts" ADD CONSTRAINT "media_parts_parent_id_media_parts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saga_members" ADD CONSTRAINT "saga_members_saga_id_sagas_id_fk" FOREIGN KEY ("saga_id") REFERENCES "public"."sagas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saga_members" ADD CONSTRAINT "saga_members_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_entries_user_status_idx" ON "library_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "library_entries_public_media_idx" ON "library_entries" USING btree ("media_id") WHERE "library_entries"."visibility" = 'public';--> statement-breakpoint
CREATE INDEX "media_external_ids_media_idx" ON "media_external_ids" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "media_items_type_popularity_idx" ON "media_items" USING btree ("type","popularity" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "media_items_search_vector_idx" ON "media_items" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "media_parts_parent_idx" ON "media_parts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "saga_members_media_idx" ON "saga_members" USING btree ("media_id");