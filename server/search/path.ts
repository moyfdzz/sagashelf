import {
  queryMaxLength,
  queryMinLength,
  searchTypeSchema,
  type SearchType,
} from "./normalize";

/** The address of the search for a text and a tab: `/search?q=dune&type=book`. */
export function searchPath(q: string, type: SearchType | undefined): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  const text = params.toString();
  return text ? `/search?${text}` : "/search";
}

/**
 * The address of the results a person came from, read from the `Referer` of a title page, or null
 * when they did not come from the search. Only the search of this site counts (same origin, and
 * the path is exactly `/search`), and only the text and the tab are read, checked with the rules
 * of the search itself. The address is built again with `searchPath`, so whatever the `Referer`
 * held, the result can only ever be `/search?q=...&type=...`.
 */
export function searchBackPath(
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
  if (from.origin !== origin || from.pathname !== "/search") return null;

  const q = (from.searchParams.get("q") ?? "").trim();
  const length = [...q].length;
  // A search that would not run (too short or too long) has no results to go back to.
  if (length < queryMinLength || length > queryMaxLength) return null;

  const type = searchTypeSchema.safeParse(from.searchParams.get("type"));
  return searchPath(q, type.success ? type.data : undefined);
}
