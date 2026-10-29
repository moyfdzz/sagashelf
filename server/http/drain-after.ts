import { drainBody } from "./body";

/**
 * Runs the handler of the whole app and, before its answer goes out, reads and throws away what is
 * left of the body of the request. The handler may answer without reading it, and not only in our
 * code: React Router refuses a form from another site (`throwIfPotentialCSRFAttack`) before any
 * route runs. With Miniflare, which runs the app in development, in the tests and in the preview,
 * an answer given over an unread body breaks the connection, and the next request on it answers
 * 500 ("fetch failed"). Doing it here, once, covers every refusal, so a route does not have to
 * remember it (SAG-53 did it route by route, SAG-69 found the ones it missed).
 *
 * `drainBody` does nothing for a GET, a HEAD or a body that was read, stops after a limit and
 * never throws, so this changes nothing for a request that was handled normally.
 */
export async function answerAndDrain(
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handle();
  } finally {
    await drainBody(request);
  }
}
