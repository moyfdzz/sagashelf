CREATE TABLE "saga_wikidata_members" (
	"saga_id" uuid NOT NULL,
	"qid" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saga_wikidata_members_saga_id_qid_pk" PRIMARY KEY("saga_id","qid"),
	CONSTRAINT "saga_wikidata_members_qid_check" CHECK ("saga_wikidata_members"."qid" ~ '^Q[0-9]{1,12}$')
);
--> statement-breakpoint
ALTER TABLE "sagas" ADD COLUMN "titles" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sagas" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "wikidata_items" ADD COLUMN "year" smallint;--> statement-breakpoint
ALTER TABLE "wikidata_items" ADD COLUMN "details_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_wikidata_members" ADD CONSTRAINT "saga_wikidata_members_saga_id_sagas_id_fk" FOREIGN KEY ("saga_id") REFERENCES "public"."sagas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saga_wikidata_members_qid_idx" ON "saga_wikidata_members" USING btree ("qid");--> statement-breakpoint
ALTER TABLE "wikidata_items" ADD CONSTRAINT "wikidata_items_year_check" CHECK ("wikidata_items"."year" is null or "wikidata_items"."year" between 1000 and 2200);