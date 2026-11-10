import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId } from "./shared";
import { users } from "./users";

/**
 * One import of a library file (SAG-241, ADR-047). The titles we already hold are written when the
 * file is uploaded; the ones only a provider knows wait in `import_rows` until the job of the
 * background queue asks for them, inside the per-person budget of new titles. The counters say what
 * was written; what is left to do and what went wrong is read from the rows. Erased with the
 * account and deleted 30 days after it was made.
 */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The choices of the person at the moment they confirmed.
    replace: boolean("replace").notNull(),
    keepVisibility: boolean("keep_visibility").notNull(),
    locale: text("locale").notNull(),
    // Entries of the file, the ones that were left out included.
    total: integer("total").notNull(),
    added: integer("added").notNull().default(0),
    replaced: integer("replaced").notNull().default(0),
    kept: integer("kept").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("import_jobs_locale_check", sql`${t.locale} in ('es', 'en')`),
    check(
      "import_jobs_counts_check",
      sql`${t.total} >= 0 and ${t.added} >= 0 and ${t.replaced} >= 0 and ${t.kept} >= 0`,
    ),
    // The page shows the latest job of a person, and the cleanup looks at age only.
    index("import_jobs_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("import_jobs_created_idx").on(t.createdAt),
  ],
);

/** The reasons a title of a file is left out, written once for the table and the code. */
export const importSkipReasons = [
  "invalid",
  "no_source",
  "duplicate",
  "unsupported_provider",
  "not_found",
  "failed",
] as const;

/**
 * An entry of an import that is not in the library: `pending` (waiting for its turn, with the entry
 * to write once the title is saved) or `skipped` (with the reason, shown to the person). A title
 * that was written leaves no row.
 */
export const importRows = pgTable(
  "import_rows",
  {
    id: primaryId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    // The place in the file, so the list keeps its order.
    position: integer("position").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    reason: text("reason"),
    // The entry as the file said it (already validated), only while it is pending.
    entry: jsonb("entry"),
    // Times the provider did not answer. At 3 the title is skipped as `failed`.
    attempts: smallint("attempts").notNull().default(0),
    // Not looked at before this moment: a lease while a run works on it, a pause after a failure,
    // and the next UTC midnight when the day's budget is spent.
    retryAt: timestamp("retry_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_rows_job_position_unique").on(t.jobId, t.position),
    check("import_rows_state_check", sql`${t.state} in ('pending', 'skipped')`),
    check(
      "import_rows_reason_check",
      sql`(${t.state} = 'skipped') = (${t.reason} is not null)
        and (${t.reason} is null or ${t.reason} in ('invalid', 'no_source', 'duplicate', 'unsupported_provider', 'not_found', 'failed'))`,
    ),
    check(
      "import_rows_entry_check",
      sql`(${t.state} = 'pending') = (${t.entry} is not null)`,
    ),
    check(
      "import_rows_title_length_check",
      sql`char_length(${t.title}) <= 300`,
    ),
    check("import_rows_attempts_check", sql`${t.attempts} between 0 and 3`),
    // What the queue looks for: pending rows that are due.
    index("import_rows_due_idx")
      .on(t.retryAt)
      .where(sql`${t.state} = 'pending'`),
    index("import_rows_job_state_idx").on(t.jobId, t.state, t.position),
  ],
);
