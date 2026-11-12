import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
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
    // Only for the speed of a page load (SAG-254): the three Core Web Vitals of one load, each one
    // empty when the browser cannot measure it (CLS only exists in Chromium; INP needs a click).
    // Milliseconds for LCP and INP, a score with no unit for CLS.
    lcpMs: doublePrecision("lcp_ms"),
    cls: doublePrecision("cls"),
    inpMs: doublePrecision("inp_ms"),
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
      sql`${t.kind} in ('pageview', 'engaged', 'search', 'signup', 'add_to_library', 'follow', 'vitals')`,
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
    // A speed event has at least one of the three numbers and the others have none, and each is in
    // a range a real page cannot pass (a minute, and a score of 100).
    check(
      "analytics_events_vitals_check",
      sql`(${t.kind} = 'vitals') = (${t.lcpMs} is not null or ${t.cls} is not null or ${t.inpMs} is not null) and (${t.lcpMs} is null or ${t.lcpMs} between 0 and 60000) and (${t.inpMs} is null or ${t.inpMs} between 0 and 60000) and (${t.cls} is null or ${t.cls} between 0 and 100)`,
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

/** The dimensions of the daily rollup, written once for the table, the job and the tests. */
export const analyticsDimensions = [
  "kind",
  "page",
  "referrer_class",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "country",
  "region",
  "device",
  "search_type",
] as const;

/**
 * The daily rollup of the raw events (SAG-24, ADR-050): one row for each day, dimension and value,
 * kept forever, so the raw events can be deleted after 13 months. `events` counts what a person did
 * (a page view, a search, a step of the funnel) and not the times on a page; `visitors` counts the
 * distinct visitors of that day (a visitor is a hash that changes every day, so it never adds up
 * across days); `engaged_ms` is the visible time. The dimension `kind` always has a row for a day
 * that was rolled up, and that row is what says so. Past 100 values a day, the rest of a dimension
 * is one row with the value `(other)`, so a forged flood of values cannot grow a table that is kept
 * forever.
 */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    day: date("day").notNull(),
    dimension: text("dimension").notNull(),
    value: text("value").notNull(),
    events: integer("events").notNull(),
    visitors: integer("visitors").notNull(),
    engagedMs: bigint("engaged_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.dimension, t.value] }),
    check(
      "analytics_daily_dimension_check",
      sql`${t.dimension} in ('kind', 'page', 'referrer_class', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'country', 'region', 'device', 'search_type')`,
    ),
    check("analytics_daily_value_check", sql`char_length(${t.value}) <= 200`),
    check(
      "analytics_daily_counts_check",
      sql`${t.events} >= 0 and ${t.visitors} >= 0 and ${t.engagedMs} >= 0`,
    ),
  ],
);

/**
 * The daily rollup of the speed of the pages (SAG-254, ADR-050): for each day, kind of page and
 * Core Web Vital, how many loads were measured, the 75th percentile (the number Google asks to
 * judge a page by) and how many were good, needed improvement or were poor by the thresholds of
 * `server/analytics/vitals.ts`. Kept forever, like `analytics_daily`, and it holds no visitor. The
 * page is the one where the visit started, since the browser measures a document and not each move
 * inside the app. Past 100 pages a day, the rest is one row `(other)`.
 */
export const analyticsVitalsDaily = pgTable(
  "analytics_vitals_daily",
  {
    day: date("day").notNull(),
    page: text("page").notNull(),
    metric: text("metric").notNull(),
    samples: integer("samples").notNull(),
    p75: doublePrecision("p75").notNull(),
    good: integer("good").notNull(),
    needsImprovement: integer("needs_improvement").notNull(),
    poor: integer("poor").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.page, t.metric] }),
    check(
      "analytics_vitals_daily_metric_check",
      sql`${t.metric} in ('LCP', 'CLS', 'INP')`,
    ),
    check(
      "analytics_vitals_daily_page_check",
      sql`char_length(${t.page}) between 1 and 200`,
    ),
    check(
      "analytics_vitals_daily_counts_check",
      sql`${t.samples} > 0 and ${t.good} >= 0 and ${t.needsImprovement} >= 0 and ${t.poor} >= 0 and ${t.good} + ${t.needsImprovement} + ${t.poor} = ${t.samples} and ${t.p75} >= 0`,
    ),
  ],
);
