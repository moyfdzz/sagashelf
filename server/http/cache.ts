/**
 * What a route says about caching, written once (SAG-117, ADR-033). An answer that carries a
 * person's data, or a page that depends on who is looking, is never kept by a shared cache. A
 * route does not write this by hand: it uses `privateHeaders` for an answer it builds, and
 * `privateRouteHeaders` or `mergePrivateHeaders` as its `headers` export.
 */
export const privateHeaders = { "Cache-Control": "private, no-store" };

/** The `headers` export of a route that only has to say its page is never cached. */
export const privateRouteHeaders = () => privateHeaders;

type RouteHeaders = { actionHeaders?: Headers; loaderHeaders?: Headers };

/**
 * The `headers` export of a route that has an action (or whose loader may set a cookie): the
 * headers of the loader and of the action, the cookie of both kept, and the cache rule on top so
 * neither can loosen it. React Router asks for it for the page and for its data requests alike.
 */
export function mergePrivateHeaders({
  actionHeaders,
  loaderHeaders,
}: RouteHeaders): Headers {
  const merged = new Headers(loaderHeaders);
  actionHeaders?.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") merged.append(key, value);
    else merged.set(key, value);
  });
  merged.set("Cache-Control", privateHeaders["Cache-Control"]);
  return merged;
}
