import { formatFeedCursor, parseFeedCursor } from "../db/feed";

/**
 * Where a person goes after liking an event without JavaScript (SAG-22): back to the page of the
 * feed they were on. Only `/social` of this site is accepted from the `Referer`, and only the cursor
 * of the feed is kept from its address (a search is not repeated, so it never spends the limit of
 * searches). Anything else goes to `/social`.
 */
export function socialBackPath(referer: string | null, origin: string): string {
  if (!referer) return "/social";
  try {
    const from = new URL(referer);
    if (from.origin !== origin || from.pathname !== "/social") return "/social";
    const before = parseFeedCursor(from.searchParams.get("before"));
    return before
      ? `/social?${new URLSearchParams({ before: formatFeedCursor(before) })}`
      : "/social";
  } catch {
    return "/social";
  }
}
