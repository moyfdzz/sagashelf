import { libraryBackPath } from "./path";

// A title page, as `mediaPath` writes it: `/media/<kind>/<words>-<id>`, in lowercase.
const titlePage =
  /^\/media\/(?:anime|movie|series|book|manga)\/[a-z0-9-]{1,140}$/;

/**
 * Where a person goes after a form of the library that they sent without JavaScript, so they
 * come back to the page they were on: the library as they left it, or the title page. It is read
 * from the `Referer` and only the pages of this site that these forms live on are accepted; the
 * library is built again with `libraryBackPath`, and a title page is only its path. Anything else
 * goes to `fallback`, so a `Referer` never takes a person anywhere else.
 */
export function returnPath(
  referer: string | null,
  origin: string,
  fallback: string,
): string {
  const library = libraryBackPath(referer, origin);
  if (library) return library;
  if (!referer) return fallback;

  try {
    const from = new URL(referer);
    if (from.origin === origin && titlePage.test(from.pathname)) {
      return from.pathname;
    }
  } catch {
    // Not an address: the fallback.
  }
  return fallback;
}
