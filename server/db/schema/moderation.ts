import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps } from "./shared";
import { users } from "./users";

export const reportTargetType = pgEnum("report_target_type", [
  "user",
  "custom_entry",
  "list",
  "activity",
  "picture",
]);

export const reportReason = pgEnum("report_reason", [
  "spam",
  "harassment",
  "inappropriate",
  "copyright",
  "other",
  "sexual_content",
  "sexual_minors",
  "other_person",
  "violent",
  "impersonation",
  "hate",
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
    // Which picture was reported, since the person can change it. The id of the target is the person.
    pictureUrl: text("picture_url"),
    // When the reporter took it back. It stays, as a record of what was said.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    status: reportStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // A person reports the same thing once, each picture apart, and again after cancelling.
    uniqueIndex("reports_reporter_target_active_unique")
      .on(
        t.reporterId,
        t.targetType,
        t.targetId,
        sql`coalesce(${t.pictureUrl}, '')`,
      )
      .where(sql`${t.cancelledAt} is null`),
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

/**
 * One row for each try to upload a profile picture that reached the moderation service (SAG-142,
 * ADR-038): who, when, the hash of the file and not the file, the answer and the IP address. It is
 * what a report of an upload would need. It is deleted after 90 days, also for an erased account, so
 * deleting an account does not erase the trace of what it tried to publish.
 */
export const pictureUploads = pgTable(
  "picture_uploads",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sha256: text("sha256").notNull(),
    result: text("result").notNull(),
    // The scores of the service, when it gave an answer.
    scores: jsonb("scores").$type<Record<string, number>>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "picture_uploads_result_check",
      sql`${t.result} in ('allowed', 'rejected', 'unavailable')`,
    ),
    index("picture_uploads_user_idx").on(t.userId, t.createdAt.desc()),
    // The cleanup looks at age only.
    index("picture_uploads_created_idx").on(t.createdAt),
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
