import { sql } from "drizzle-orm";

import type { Locale } from "../providers/types";
import type { LocalizedText } from "./schema/shared";

/**
 * The title in the language of the visitor as SQL, falling back to the title saved last. `alias`
 * is the table name or alias in the query. An empty text counts as missing.
 */
export const localizedTitleSql = (alias: string, locale: Locale) =>
  sql<string>`coalesce(nullif(${sql.raw(alias)}.titles->>${locale}::text, ''), ${sql.raw(alias)}.title)`;

/** The same rule for a row that is already in memory. */
export const pickTitle = (
  row: { title: string; titles: LocalizedText },
  locale: Locale,
): string => row.titles[locale] || row.title;
