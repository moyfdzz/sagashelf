import { afterAll, afterEach, beforeAll } from "vitest";

import { mswServer } from "./msw";

// Any request without a registered handler fails the test instead of hitting the network.
beforeAll(() => mswServer.listen({ onUnhandledFrame: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
