import { afterAll, afterEach, beforeAll } from "vitest";

import { mswServer } from "./msw";
import { onUnhandledFrame, takeUnhandled } from "./unhandled";

// A request without a registered handler never reaches the network, and the test that sent it
// fails (why it is not just `onUnhandledFrame: "error"` is in `unhandled.ts`).
beforeAll(() => mswServer.listen({ onUnhandledFrame }));
afterEach(() => {
  mswServer.resetHandlers();
  const sent = takeUnhandled();
  if (sent.length > 0) {
    throw new Error(
      `The test sent ${sent.length} request(s) with no handler, which is not allowed:\n${sent.join("\n")}`,
    );
  }
});
afterAll(() => mswServer.close());
