import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { mswServer } from "../../testing/msw";
import {
  adultId,
  berserkId,
  mangadexBase,
  mangadexHandlers,
  vrmmoId,
  type SeenRequest,
} from "../../testing/mangadex";
import { providerUserAgent } from "../http";
import { createMangadexProviderWithDefaults } from ".";

// No pauses between retries, so the tests are quick.
const fast = { sleep: async () => undefined, retries: 1 };

function setup(seen: SeenRequest[] = [], removed?: ReadonlySet<string>) {
  mswServer.use(...mangadexHandlers(seen));
  return createMangadexProviderWithDefaults(fast, removed);
}

describe("the MangaDex provider (contract)", () => {
  it("says what it covers and what it owes", () => {
    const provider = setup();

    expect(provider.id).toBe("mangadex");
    expect(provider.capabilities).toEqual({
      types: ["manga"],
      parts: false,
      trending: false,
    });
    expect(provider.attribution.name).toBe("MangaDex");
  });

  it("searches manga with the cover and the authors in the same call, by relevance", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    const items = await provider.search("berserk", { locale: "es" });

    expect(items.map((item) => item.externalId.id)).toEqual([
      berserkId,
      vrmmoId,
    ]);
    expect(items[0]).toMatchObject({
      type: "manga",
      creators: ["Miura Kentarou"],
    });
    const query = seen[0]?.url.searchParams;
    expect(query?.get("title")).toBe("berserk");
    expect(query?.get("limit")).toBe("20");
    expect(query?.get("order[relevance]")).toBe("desc");
    expect(query?.getAll("includes[]")).toEqual([
      "cover_art",
      "author",
      "artist",
    ]);
  });

  it("asks only for the ratings we show, and drops adult material the API sends anyway", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    const items = await provider.search("berserk", { locale: "en" });

    expect(seen[0]?.url.searchParams.getAll("contentRating[]")).toEqual([
      "safe",
      "suggestive",
    ]);
    expect(items.map((item) => item.title)).not.toContain("Adults only");
  });

  it("sends the User-Agent that identifies the app, and no Via header", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    await provider.search("berserk", { locale: "en" });

    expect(seen[0]?.headers.get("user-agent")).toBe(providerUserAgent);
    expect(seen[0]?.headers.has("via")).toBe(false);
  });

  it("answers an empty list for no match, an empty text or another type, without a call", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    expect(await provider.search("qzxwvkjhgfdsa", { locale: "es" })).toEqual(
      [],
    );
    expect(await provider.search("  ", { locale: "es" })).toEqual([]);
    expect(
      await provider.search("berserk", { type: "book", locale: "es" }),
    ).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("reads one manga in a single call", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    const manga = await provider.getById(berserkId, { locale: "en" });

    expect(manga).toMatchObject({ title: "Berserk", year: 1989 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.pathname).toBe(`/manga/${berserkId}`);
  });

  it("answers null for a manga that does not exist, an id that is not one and adult material", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    expect(
      await provider.getById("11111111-1111-4111-8111-111111111111", {
        locale: "en",
      }),
    ).toBeNull();
    expect(await provider.getById("OL893414W", { locale: "en" })).toBeNull();
    expect(await provider.getById(adultId, { locale: "en" })).toBeNull();
    // The id that is not one never reaches the API.
    expect(seen).toHaveLength(2);
  });

  it("never reads chapters", async () => {
    expect(await setup().getParts(berserkId)).toEqual([]);
  });

  it("leaves a removed title out of the search and answers null when it is opened, without a call", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen, new Set([`mangadex:${vrmmoId}`]));

    const items = await provider.search("berserk", { locale: "en" });
    const opened = await provider.getById(vrmmoId, { locale: "en" });

    expect(items.map((item) => item.externalId.id)).toEqual([berserkId]);
    expect(opened).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("stops at the first 429: no retry, and no more calls for a while", async () => {
    const calls = vi.fn();
    mswServer.use(
      http.get(`${mangadexBase}/manga`, () => {
        calls();
        return HttpResponse.json({}, { status: 429 });
      }),
    );
    const provider = createMangadexProviderWithDefaults(fast);

    await expect(
      provider.search("berserk", { locale: "en" }),
    ).rejects.toMatchObject({ provider: "mangadex", status: 429 });
    await expect(
      provider.search("berserk", { locale: "en" }),
    ).rejects.toMatchObject({ kind: "circuit_open" });

    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("raises a provider error when MangaDex is down", async () => {
    mswServer.use(
      http.get(`${mangadexBase}/manga`, () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    const provider = createMangadexProviderWithDefaults(fast);

    await expect(
      provider.search("berserk", { locale: "en" }),
    ).rejects.toMatchObject({ name: "ProviderError", provider: "mangadex" });
  });
});
