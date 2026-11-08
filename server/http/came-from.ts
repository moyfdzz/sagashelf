/**
 * A form that a page sends with JavaScript is a `fetch`, and its answer is data: the page changes
 * in place. The same form without JavaScript is a document, and the person goes to another page.
 * `Sec-Fetch-Dest` says which, and only the first is `empty`.
 */
export const asksForData = (request: Request): boolean =>
  request.headers.get("Sec-Fetch-Dest") === "empty";

/** The page the form was sent from, when it is on this site, to bring the person back to it. */
export function cameFrom(request: Request): string {
  const referer = request.headers.get("Referer");
  if (!referer) return request.url;
  try {
    const from = new URL(referer);
    return from.origin === new URL(request.url).origin
      ? from.href
      : request.url;
  } catch {
    return request.url;
  }
}
