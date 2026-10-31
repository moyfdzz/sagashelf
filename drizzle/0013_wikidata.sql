CREATE TABLE "media_wikidata" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"qid" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_wikidata_qid_check" CHECK ("media_wikidata"."qid" is null or "media_wikidata"."qid" ~ '^Q[0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "wikidata_items" (
	"qid" text PRIMARY KEY NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" text DEFAULT 'other' NOT NULL,
	"ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wikidata_items_qid_check" CHECK ("wikidata_items"."qid" ~ '^Q[0-9]{1,12}$'),
	CONSTRAINT "wikidata_items_labels_check" CHECK (jsonb_typeof("wikidata_items"."labels") = 'object' and jsonb_typeof("wikidata_items"."ids") = 'object')
);
--> statement-breakpoint
CREATE TABLE "wikidata_links" (
	"from_qid" text NOT NULL,
	"to_qid" text NOT NULL,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wikidata_links_from_qid_to_qid_relation_pk" PRIMARY KEY("from_qid","to_qid","relation"),
	CONSTRAINT "wikidata_links_relation_check" CHECK ("wikidata_links"."relation" in ('franchise', 'based_on'))
);
--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "cross_ids" jsonb;--> statement-breakpoint
ALTER TABLE "media_wikidata" ADD CONSTRAINT "media_wikidata_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_wikidata_qid_idx" ON "media_wikidata" USING btree ("qid");--> statement-breakpoint
CREATE INDEX "wikidata_links_to_idx" ON "wikidata_links" USING btree ("to_qid","relation");--> statement-breakpoint
CREATE INDEX "media_items_cross_ids_idx" ON "media_items" USING gin ("cross_ids" jsonb_path_ops);