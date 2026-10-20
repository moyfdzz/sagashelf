import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "./msw";

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

  it("rejects requests without a handler instead of calling the network", async () => {
    await expect(fetch("https://unmocked.test/anything")).rejects.toThrow();
  });
});
