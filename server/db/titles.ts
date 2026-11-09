import { sql } from "drizzle-orm";

import type { Locale } from "../providers/types";
import type { Relationship } from "../social/can-view";
import type { LocalizedText } from "./schema/shared";

/**
 * The title in the language of the visitor as SQL, falling back to the title saved last. `alias`
 * is the table name or alias in the query. An empty text counts as missing.
 */
export const localizedTitleSql = (alias: string, locale: Locale) =>
  sql<string>`coalesce(nullif(${sql.raw(alias)}.titles->>${locale}::text, ''), ${sql.raw(alias)}.title)`;

/**
 * The one rule for "this title may come out of a query that shows it to somebody": a title that a
 * person made for themselves (`custom`) never does (SAG-196). The schema says a custom title is
 * private until its owner shares it and a moderator approves it, but nothing writes or reads that
 * state yet, so the rule is the type. When SAG-19 adds the writer, change it here and every query
 * follows. `alias` is the table name or alias of `media_items` in the query. A query that lets the
 * owner see their own custom titles says so next to this fragment (see `addListItem`).
 */
export const sharedTitleSql = (alias: string) =>
  sql`${sql.raw(alias)}.type <> 'custom'`;

/**
 * The same rule for a page of a person's profile: the owner looking at their own page sees their
 * own custom titles, everybody else goes through `sharedTitleSql`. Written as SQL words, not a
 * bound parameter (the Neon driver cannot be tried locally).
 */
export const titleShownSql = (alias: string, relationship: Relationship) =>
  relationship === "owner" ? sql`true` : sharedTitleSql(alias);

/** The same rule for a row that is already in memory. */
export const pickTitle = (
  row: { title: string; titles: LocalizedText },
  locale: Locale,
): string => row.titles[locale] || row.title;
