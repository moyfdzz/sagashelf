import { HttpNetworkFrame } from "msw/experimental";

import type { mswServer } from "./msw";

type ListenOptions = NonNullable<Parameters<typeof mswServer.listen>[0]>;

// A request nobody wrote a handler for. It is answered here, at once, and the test that sent it
// fails in `afterEach` (see `setup.ts`) naming it.
//
// `onUnhandledFrame: "error"` is not used on purpose: with msw 3.0.3 it does not stop the request
// (measured on 2026-11-03: with no handlers, a `fetch` to openlibrary.org got a real 200 from the
// provider's server), so a test could reach the network and only fail when the provider was slow.
// Failing in `afterEach` and not in the answer matters too: the providers swallow a 5xx as "the
// provider is down", so an answer alone would let a test pass without noticing.
const unhandled: string[] = [];

export const onUnhandledFrame: NonNullable<
  ListenOptions["onUnhandledFrame"]
> = ({ frame }) => {
  unhandled.push(
    frame instanceof HttpNetworkFrame
      ? `${frame.data.request.method} ${frame.data.request.url}`
      : "a non-HTTP connection",
  );
  throw new Response("No request handler for this request in the tests", {
    status: 501,
  });
};

/** What was sent with no handler since the last call; empties the list. */
export function takeUnhandled(): string[] {
  return unhandled.splice(0);
}
