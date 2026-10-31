import { describe, expect, it } from "vitest";

import { mswServer } from "../../testing/msw";
import {
  limitedId,
  missingId,
  simpsonsId,
  titanId,
  tvmazeHandlers,
  type SeenShow,
} from "../../testing/tvmaze";
import { providerUserAgent, ProviderError } from "../http";
import { createTvmazeClientWithDefaults } from ".";

// No pauses between retries, so the tests are quick.
const fast = { sleep: async () => undefined };

function setup(seen: SeenShow[] = []) {
  mswServer.use(...tvmazeHandlers(seen));
  return createTvmazeClientWithDefaults(fast);
}

describe("the TVmaze client (SAG-90)", () => {
  it("asks for the show with its next episode in one call, with the shared User-Agent", async () => {
    const seen: SeenShow[] = [];
    const client = setup(seen);

    const show = await client.getShow(simpsonsId);

    expect(show).toMatchObject({
      status: "Running",
      next: { airDate: "2026-11-01", season: 38, number: 5 },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.pathname).toBe(`/shows/${simpsonsId}`);
    expect(seen[0]?.url.searchParams.get("embed")).toBe("nextepisode");
    expect(seen[0]?.headers.get("user-agent")).toBe(providerUserAgent);
  });

  it("says a show that is over has no next episode", async () => {
    expect(await setup().getShow(titanId)).toEqual({
      status: "Ended",
      next: null,
    });
  });

  it("answers null for a show TVmaze does not know", async () => {
    expect(await setup().getShow(missingId)).toBeNull();
  });

  it("never asks about an id that is not a plain number", async () => {
    const seen: SeenShow[] = [];
    const client = setup(seen);

    for (const id of [0, -1, 1.5, Number.NaN, 1e12]) {
      expect(await client.getShow(id)).toBeNull();
    }
    expect(seen).toHaveLength(0);
  });

  it("stops at a 429 without trying again, and keeps quiet afterwards", async () => {
    const seen: SeenShow[] = [];
    const client = setup(seen);

    await expect(client.getShow(limitedId)).rejects.toMatchObject({
      kind: "http",
      status: 429,
    });
    // The circuit is open: the next call is not even sent.
    await expect(client.getShow(simpsonsId)).rejects.toBeInstanceOf(
      ProviderError,
    );

    expect(seen).toHaveLength(1);
  });
});
