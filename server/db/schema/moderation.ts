import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps } from "./shared";
import { users } from "./users";

export const reportTargetType = pgEnum("report_target_type", [
  "user",
  "custom_entry",
  "list",
  "activity",
]);

export const reportReason = pgEnum("report_reason", [
  "spam",
  "harassment",
  "inappropriate",
  "copyright",
  "other",
]);

export const reportStatus = pgEnum("report_status", [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
]);

/**
 * A report about a person or a piece of content. The target is polymorphic (a type and an id),
 * so the id has no foreign key: a report must outlive the content it is about.
 */
export const reports = pgTable(
  "reports",
  {
    id: primaryId(),
    // Kept (with no reporter) if the reporter deletes their account.
    reporterId: uuid("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetType: reportTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: reportReason("reason").notNull(),
    details: text("details"),
    status: reportStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // A person reports the same thing once.
    unique("reports_reporter_target_unique").on(
      t.reporterId,
      t.targetType,
      t.targetId,
    ),
    check(
      "reports_details_length_check",
      sql`char_length(${t.details}) <= 1000`,
    ),
    // The moderation queue.
    index("reports_open_idx")
      .on(t.createdAt)
      .where(sql`${t.status} in ('open', 'reviewing')`),
    index("reports_target_idx").on(t.targetType, t.targetId),
  ],
);

/** An append-only record of sensitive actions (bans, approvals, role changes). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    // What changed. Never tokens, passwords or full email addresses.
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt.desc()),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);
