import { z } from "zod";

import {
  libraryQuerySchema,
  sectionOrder,
  type LibraryQuery,
  type LibraryStatus,
  type LibraryType,
  type LibraryView,
} from "./schema";

export type Change = {
  /** `null` is the tab with every type. */
  type?: LibraryType | null;
  view?: LibraryView;
  /** Drops the search, the filters and the sort. The tab and the view stay. */
  clear?: boolean;
  /** One section goes to another page; the other sections stay where they are. */
  section?: { status: LibraryStatus; page: number };
  /** Drops the exact score and keeps the rest of the filters. */
  unrate?: boolean;
  /** Keeps the page of every section. Without it (and without `section`) they all go to the first. */
  keepPages?: boolean;
};

/**
 * The address of the library with the search and the filters kept. Changing the tab or the view
 * sends every section back to its first page; changing the page of one section keeps the rest.
 */
export function libraryPath(
  query: LibraryQuery,
  pages: Record<LibraryStatus, number>,
  change: Change = {},
): string {
  const params = new URLSearchParams();
  const type = change.type === undefined ? query.type : change.type;
  if (type) params.set("type", type);
  if (!change.clear) {
    if (query.q) params.set("q", query.q);
    if (query.year) params.set("year", String(query.year));
    if (query.score) params.set("score", String(query.score));
    if (query.rated && !change.unrate) params.set("rated", String(query.rated));
    if (query.visibility) params.set("visibility", query.visibility);
    if (query.sort !== "recent") params.set("sort", query.sort);
  }
  const view = change.view ?? query.view;
  if (view) params.set("view", view);
  if (change.section || change.keepPages) {
    for (const status of sectionOrder) {
      const page =
        change.section && status === change.section.status
          ? change.section.page
          : pages[status];
      if (page > 1) params.set(`${status}_page`, String(page));
    }
  }
  const text = params.toString();
  return text ? `/library?${text}` : "/library";
}

/**
 * The address of the library as the person left it, read from the `Referer` of the entry page, or
 * null when they did not come from the library. Only the library of this site counts (same
 * origin, and the path is exactly `/library`). The tab, the search, the filters, the sort, the
 * view and the page of each section are read with the schema of the library page itself and the
 * address is built again with `libraryPath`, so whatever the `Referer` held, the result can only be
 * `/library` and the parameters the page knows.
 */
export function libraryBackPath(
  referer: string | null,
  origin: string,
): string | null {
  if (!referer) return null;

  let from: URL;
  try {
    from = new URL(referer);
  } catch {
    return null;
  }
  if (from.origin !== origin || from.pathname !== "/library") return null;

  const query = libraryQuerySchema.parse(Object.fromEntries(from.searchParams));
  return libraryPath(query, query.pages, { keepPages: true });
}

const entryId = z.uuid();

/**
 * The address of the entry a person came from, read from the `Referer` of a title page, or null
 * when they did not come from an entry. Only `/library/<id>` of this site counts, with an id that
 * is a UUID; the address is built again from the id, in lowercase, and nothing else is kept.
 */
export function entryBackPath(
  referer: string | null,
  origin: string,
): string | null {
  if (!referer) return null;

  let from: URL;
  try {
    from = new URL(referer);
  } catch {
    return null;
  }
  if (from.origin !== origin) return null;

  const match = /^\/library\/([^/]+)$/.exec(from.pathname);
  const id = entryId.safeParse(match?.[1]);
  return id.success ? `/library/${id.data.toLowerCase()}` : null;
}
