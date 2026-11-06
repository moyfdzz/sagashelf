import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
    // False when the address is the generated image of Clerk, so there is nothing to remove or to
    // report (SAG-144). True by default: a real picture must never lose its "report" link.
    hasOwnPicture: boolean("has_own_picture").notNull().default(true),
    // The address of a picture an administrator hid or a report of minors hid (SAG-143). While it
    // equals the address Clerk sends, `avatar_url` stays empty, so a `user.updated` cannot bring the
    // picture back. A different address is a new picture and is shown.
    hiddenAvatarUrl: text("hidden_avatar_url"),
    // What an administrator did to the account (SAG-143, ADR-040). A suspended account cannot sign
    // in and stays visible. A banned one cannot either, and its profile is put at the level `private`
    // so every screen hides it with the one policy of ADR-031; the level it had is kept to be given
    // back when the ban is lifted.
    moderationStatus: text("moderation_status").notNull().default("active"),
    moderationChangedAt: timestamp("moderation_changed_at", {
      withTimezone: true,
    }),
    privacyBeforeBan: privacyLevel("privacy_before_ban"),
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
    // How many pictures the person tried to upload on this day, in UTC (SAG-109). Each one costs
    // a check by the moderation service, so the count includes the ones it refused.
    avatarUploadsDay: date("avatar_uploads_day", { mode: "string" }),
    avatarUploadsCount: smallint("avatar_uploads_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      "users_username_length_check",
      sql`char_length(${t.username}::text) between 3 and 30`,
    ),
    check("users_locale_check", sql`${t.locale} in ('es', 'en')`),
    check(
      "users_moderation_status_check",
      sql`${t.moderationStatus} in ('active', 'suspended', 'banned')`,
    ),
    check("users_bio_length_check", sql`char_length(${t.bio}) <= 500`),
  ],
);
