import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps } from "./shared";
import { users } from "./users";

export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "delivered",
  "failed",
]);

/**
 * The transactional outbox (ADR-007). An event is written here in the same transaction as the
 * change that caused it, and the Cron handler delivers it later, with retries.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: primaryId(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // Makes a retry safe: the same event cannot be queued, or delivered, twice.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    check("outbox_attempts_check", sql`${t.attempts} >= 0`),
    // What the Cron handler reads every minute: pending events that are due.
    index("outbox_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const webhookKind = pgEnum("webhook_kind", ["discord", "generic"]);

/** Where a person wants events sent. The URL is validated in the app (SAG-27); the database only insists on HTTPS. */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: webhookKind("kind").notNull(),
    url: text("url").notNull(),
    eventTypes: text("event_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    // The signing secret of a generic endpoint, encrypted with a key kept as a Workers secret.
    // Never stored in plain text (SAG-27).
    secretEncrypted: text("secret_encrypted"),
    failureCount: integer("failure_count").notNull().default(0),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("webhook_endpoints_https_check", sql`${t.url} like 'https://%'`),
    check("webhook_endpoints_failure_count_check", sql`${t.failureCount} >= 0`),
    index("webhook_endpoints_user_idx").on(t.userId),
  ],
);

/** One delivery attempt: the status, how long it took and the error, never any secret. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: primaryId(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => outbox.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    statusCode: integer("status_code"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // An attempt is recorded once.
    unique("webhook_deliveries_outbox_endpoint_attempt_unique").on(
      t.outboxId,
      t.endpointId,
      t.attempt,
    ),
    check("webhook_deliveries_attempt_check", sql`${t.attempt} >= 1`),
    index("webhook_deliveries_endpoint_created_idx").on(
      t.endpointId,
      t.createdAt.desc(),
    ),
  ],
);

export const webhookProvider = pgEnum("webhook_provider", ["clerk", "stripe"]);

/** Incoming events already handled: a repeated event id is ignored, which makes retries safe. */
export const processedWebhooks = pgTable(
  "processed_webhooks",
  {
    provider: webhookProvider("provider").notNull(),
    eventId: text("event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);
