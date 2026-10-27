CREATE TABLE "library_viewings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entry_id" uuid NOT NULL,
	"started_on" date,
	"finished_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_viewings_dates_check" CHECK ("library_viewings"."started_on" is null or "library_viewings"."finished_on" is null or "library_viewings"."finished_on" >= "library_viewings"."started_on"),
	CONSTRAINT "library_viewings_notes_length_check" CHECK (char_length("library_viewings"."notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "library_viewings" ADD CONSTRAINT "library_viewings_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_viewings_entry_idx" ON "library_viewings" USING btree ("entry_id");