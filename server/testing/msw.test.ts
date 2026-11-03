import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "./msw";
import { takeUnhandled } from "./unhandled";

describe("MSW guard", () => {
  it("serves requests that have a registered handler", async () => {
    mswServer.use(
      http.get("https://provider.test/title", () =>
        HttpResponse.json({ name: "Dune" }),
      ),
    );

    const response = await fetch("https://provider.test/title");

    expect(await response.json()).toEqual({ name: "Dune" });
  });

  // A host that does not resolve would also make `fetch` throw, so this checks the answer MSW
  // gives (a 501), which a real network attempt could never produce.
  it("answers a request without a handler itself and keeps it to fail the test", async () => {
    const response = await fetch("https://unmocked.test/anything");

    expect(response.status).toBe(501);
    expect(takeUnhandled()).toEqual(["GET https://unmocked.test/anything"]);
  });
});
