import type { RelatedFormat } from "../db/wikidata-store";
import { pickTitle } from "../db/titles";
import type { Locale } from "../providers/types";
import { mediaPath } from "./slug";

/** The formats a page lists, in the order it lists them. */
export const relatedFormats = [
  "anime",
  "movie",
  "series",
  "manga",
  "book",
  "game",
  "other",
] as const;
export type RelatedGroupFormat = (typeof relatedFormats)[number];

export type RelatedGroup = {
  format: RelatedGroupFormat;
  items: {
    qid: string;
    label: string;
    /** The page of the title when our catalog holds it; otherwise the name is shown as text. */
    href: string | null;
  }[];
};

/**
 * The related items grouped by format, each named in the language of the visitor (then the other
 * language). An item with no name in either language is left out: there is nothing to show.
 */
export function groupRelated(
  related: readonly RelatedFormat[],
  locale: Locale,
): RelatedGroup[] {
  const other: Locale = locale === "es" ? "en" : "es";
  const groups = new Map<RelatedGroupFormat, RelatedGroup["items"]>();
  for (const entry of related) {
    const format = (relatedFormats as readonly string[]).includes(entry.format)
      ? (entry.format as RelatedGroupFormat)
      : null;
    if (!format) continue;
    const label = entry.media
      ? pickTitle(entry.media, locale)
      : (entry.labels[locale] ?? entry.labels[other]);
    if (!label) continue;
    // The type of the title we hold decides its group: it is the one the person finds it under.
    const placed = entry.media
      ? (entry.media.type as RelatedGroupFormat)
      : format;
    const items = groups.get(placed) ?? [];
    items.push({
      qid: entry.qid,
      label,
      href: entry.media
        ? mediaPath(entry.media.type, label, entry.media.id)
        : null,
    });
    groups.set(placed, items);
  }
  return relatedFormats.flatMap((format) => {
    const items = groups.get(format);
    return items ? [{ format, items }] : [];
  });
}
