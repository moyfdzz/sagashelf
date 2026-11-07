import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId } from "./shared";
import { users } from "./users";

/**
 * A message sent from the contact page (SAG-110): feedback, a problem or a request for help. A
 * signed-in person is known by `user_id` and the message is erased with the account; a visitor has
 * no `user_id` and may leave an address to be answered at, which is kept only for that. It is
 * deleted 90 days after it was sent, handled or not. The text is never copied into a notification
 * or the audit log: only the kind and the ids.
 */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: primaryId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    // Only a visitor leaves one: a signed-in person is answered through their account.
    replyEmail: text("reply_email"),
    status: text("status").notNull().default("new"),
    handledBy: uuid("handled_by").references(() => users.id, {
      onDelete: "set null",
    }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "contact_messages_kind_check",
      sql`${t.kind} in ('feedback', 'problem', 'help')`,
    ),
    check(
      "contact_messages_body_length_check",
      sql`char_length(${t.body}) between 1 and 2000`,
    ),
    check(
      "contact_messages_reply_email_length_check",
      sql`char_length(${t.replyEmail}) <= 254`,
    ),
    check(
      "contact_messages_reply_visitor_check",
      sql`${t.userId} is null or ${t.replyEmail} is null`,
    ),
    check(
      "contact_messages_status_check",
      sql`${t.status} in ('new', 'handled')`,
    ),
    check(
      "contact_messages_handled_check",
      sql`(${t.status} = 'handled') = (${t.handledAt} is not null)`,
    ),
    // The administration lists the newest first, and the cleanup looks at age only.
    index("contact_messages_created_idx").on(t.createdAt.desc()),
    // The daily limit of a signed-in person.
    index("contact_messages_user_created_idx")
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.userId} is not null`),
  ],
);
