CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"replace" boolean NOT NULL,
	"keep_visibility" boolean NOT NULL,
	"locale" text NOT NULL,
	"total" integer NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"replaced" integer DEFAULT 0 NOT NULL,
	"kept" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_locale_check" CHECK ("import_jobs"."locale" in ('es', 'en')),
	CONSTRAINT "import_jobs_counts_check" CHECK ("import_jobs"."total" >= 0 and "import_jobs"."added" >= 0 and "import_jobs"."replaced" >= 0 and "import_jobs"."kept" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"entry" jsonb,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_job_position_unique" UNIQUE("job_id","position"),
	CONSTRAINT "import_rows_state_check" CHECK ("import_rows"."state" in ('pending', 'skipped')),
	CONSTRAINT "import_rows_reason_check" CHECK (("import_rows"."state" = 'skipped') = ("import_rows"."reason" is not null)
        and ("import_rows"."reason" is null or "import_rows"."reason" in ('invalid', 'no_source', 'duplicate', 'unsupported_provider', 'not_found', 'failed'))),
	CONSTRAINT "import_rows_entry_check" CHECK (("import_rows"."state" = 'pending') = ("import_rows"."entry" is not null)),
	CONSTRAINT "import_rows_title_length_check" CHECK (char_length("import_rows"."title") <= 300),
	CONSTRAINT "import_rows_attempts_check" CHECK ("import_rows"."attempts" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_user_created_idx" ON "import_jobs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_created_idx" ON "import_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_rows_due_idx" ON "import_rows" USING btree ("retry_at") WHERE "import_rows"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "import_rows_job_state_idx" ON "import_rows" USING btree ("job_id","state","position");