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
