CREATE TABLE "media_next_episode" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"tvmaze_id" integer NOT NULL,
	"show_status" text,
	"air_date" date,
	"air_stamp" timestamp with time zone,
	"season" smallint,
	"number" smallint,
	"episode_name" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_check_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_next_episode_numbers_check" CHECK (("media_next_episode"."season" is null or "media_next_episode"."season" >= 0) and ("media_next_episode"."number" is null or "media_next_episode"."number" >= 0))
);
--> statement-breakpoint
ALTER TABLE "media_wikidata" ADD COLUMN "tvmaze_id" integer;--> statement-breakpoint
ALTER TABLE "media_wikidata" ADD COLUMN "tvmaze_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_next_episode" ADD CONSTRAINT "media_next_episode_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_next_episode_check_idx" ON "media_next_episode" USING btree ("next_check_at");