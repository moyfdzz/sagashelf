import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { primaryId } from "./shared";

/**
 * The salt of one day for the visitor hash (SAG-24, ADR-050). The server makes it once a day and
 * deletes the old ones, so the hash of a visitor cannot be followed from one day to the next and
 * no secret is needed. It is random and never leaves the server.
 */
export const analyticsSalts = pgTable("analytics_salts", {
  day: date("day").primaryKey(),
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One raw event of the cookieless analytics (SAG-24, ADR-009, ADR-050). It holds no IP address and
 * no user id: the visitor is a hash that changes every day, and the place is only the country and
 * the region. Raw events are kept 13 months. The text of a search is never stored, only its type.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: primaryId(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    kind: text("kind").notNull(),
    // The path of the page, with no query string and no fragment.
    path: text("path").notNull(),
    // The visitor of one day: a hash of the daily salt, the address and the browser.
    visitor: text("visitor").notNull(),
    // Only for a time on page, in milliseconds of a visible tab.
    engagedMs: integer("engaged_ms"),
    // Only for a search: the type of title searched, never the text.
    searchType: text("search_type"),
    // Where the visit came from: a class and, when it came from another site, its host.
    referrerClass: text("referrer_class"),
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    // From Cloudflare: the country (two letters) and the region. Never the city.
    country: text("country"),
    region: text("region"),
    device: text("device"),
  },
  (t) => [
    check(
      "analytics_events_kind_check",
      sql`${t.kind} in ('pageview', 'engaged', 'search', 'signup', 'add_to_library', 'follow')`,
    ),
    check(
      "analytics_events_path_check",
      sql`char_length(${t.path}) between 1 and 200 and left(${t.path}, 1) = '/'`,
    ),
    check(
      "analytics_events_visitor_check",
      sql`${t.visitor} ~ '^[0-9a-f]{32}$'`,
    ),
    check(
      "analytics_events_engaged_check",
      sql`(${t.kind} = 'engaged') = (${t.engagedMs} is not null) and (${t.engagedMs} is null or ${t.engagedMs} between 0 and 14400000)`,
    ),
    check(
      "analytics_events_search_check",
      sql`(${t.kind} = 'search') = (${t.searchType} is not null)`,
    ),
    check(
      "analytics_events_referrer_class_check",
      sql`${t.referrerClass} is null or ${t.referrerClass} in ('direct', 'search', 'social', 'internal', 'other')`,
    ),
    check(
      "analytics_events_device_check",
      sql`${t.device} is null or ${t.device} in ('mobile', 'desktop')`,
    ),
    check(
      "analytics_events_country_check",
      sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "analytics_events_text_length_check",
      sql`char_length(${t.referrerHost}) <= 100 and char_length(${t.utmSource}) <= 100 and char_length(${t.utmMedium}) <= 100 and char_length(${t.utmCampaign}) <= 100 and char_length(${t.region}) <= 100 and char_length(${t.searchType}) <= 20`,
    ),
    // The daily rollup reads one day at a time, and the cleanup looks at age only.
    index("analytics_events_occurred_idx").on(t.occurredAt),
  ],
);
