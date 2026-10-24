import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import {
  citext,
  primaryId,
  privacyLevel,
  timestamps,
  userRole,
} from "./shared";

/**
 * The local mirror of a Clerk account (ADR-003). Clerk owns the credentials; this table
 * owns what the product knows about the person. A deleted user keeps the row (`deleted_at`),
 * so the username, the Clerk id and the canonical email stay reserved.
 */
export const users = pgTable(
  "users",
  {
    id: primaryId(),
    clerkId: text("clerk_id").notNull().unique(),
    // citext: "Ana" and "ana" are the same username.
    username: citext("username").notNull().unique(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    locale: text("locale").notNull().default("es"),
    privacy: privacyLevel("privacy").notNull().default("public"),
    role: userRole("role").notNull().default("user"),
    // Trimmed, lowercased, with provider-specific dots and +tags removed (SAG-10). Stops one
    // inbox from creating many accounts. The address used for sending is kept by Clerk.
    emailCanonical: text("email_canonical").notNull().unique(),
    // The time Clerk gave to the last event applied to this row (SAG-11). The webhook compares
    // it with each event, so an older event that arrives late never overwrites newer data.
    // Not `updated_at`, which is when this row changed here.
    clerkUpdatedAt: timestamp("clerk_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When the person last changed the username (SAG-37). The server allows one change every 30
    // days by reading this; null until the first change.
    usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      "users_username_length_check",
      sql`char_length(${t.username}::text) between 3 and 30`,
    ),
    check("users_locale_check", sql`${t.locale} in ('es', 'en')`),
    check("users_bio_length_check", sql`char_length(${t.bio}) <= 500`),
  ],
);
