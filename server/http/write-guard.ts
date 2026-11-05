/** Why a request to write something is refused before anything else is looked at. */
export type UnsafeWrite = "too_large" | "foreign_origin";

/**
 * The first two things every write is asked, written once (SAG-128, ADR-033): whether the body is
 * bigger than the form can be, from `Content-Length`, and whether the request comes from a page of
 * another site, from `Origin`. A page on another site must not be able to change someone's data,
 * and a route that forgot this check would let it, so `app/architecture.test.ts` fails for a route
 * with an `action` that does not call it.
 *
 * The size is asked first, so a request that is both too big and foreign is `too_large`. A request
 * with no `Origin` is not foreign (a browser sends it on a form from another site, and not on a
 * call that does not come from a page). The route keeps the answer it gave before, since a page
 * reads it: this only says which of the two it was.
 *
 * The bytes that really arrive are counted when the form is read (`readForm`), since the header can
 * be left out or lie.
 */
export function checkWrite(
  request: Request,
  maxBytes: number,
): UnsafeWrite | null {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) {
    return "too_large";
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return "foreign_origin";
  }
  return null;
}
