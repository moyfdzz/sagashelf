import type { MediaKind } from "../providers/types";
import { isMediaKind, mediaPath } from "../media/slug";

/**
 * How a title inside a list is drawn, for the page of the owner and the page for others (SAG-163).
 * The type that comes from the database is checked here, once, instead of cast where it is used:
 * a title the person made for themselves has the type `custom`, which has no label and no page of
 * its own, so it is shown as plain text rather than as a missing translation and a link to a 404.
 */
export type ListTitleView = {
  mediaId: string;
  title: string;
  year: number | null;
  /** The kind to name beside the title, or null for a title with no public page. */
  type: MediaKind | null;
  /** The page of the title, or null when it has none. */
  href: string | null;
};

export function listTitleView(item: {
  mediaId: string;
  type: string;
  title: string;
  year: number | null;
}): ListTitleView {
  const kind = isMediaKind(item.type) ? item.type : null;
  return {
    mediaId: item.mediaId,
    title: item.title,
    year: item.year,
    type: kind,
    href: kind ? mediaPath(kind, item.title, item.mediaId) : null,
  };
}
