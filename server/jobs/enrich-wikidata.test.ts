import { beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../testing/msw";
import {
  animeQid,
  filmQid,
  franchiseQid,
  mangaQid,
  wikidataHandlers,
  type SeenQuery,
} from "../testing/wikidata";
import { createWikidataClientWithDefaults } from "../providers/wikidata";
import { enrichWithWikidata } from "./enrich-wikidata";

const mocks = vi.hoisted(() => ({
  findTitlesToLookUp: vi.fn(),
  saveWikidata: vi.fn(),
}));

vi.mock("../db/wikidata-store", () => ({
  findTitlesToLookUp: mocks.findTitlesToLookUp,
  saveWikidata: mocks.saveWikidata,
}));

const db = { execute: vi.fn() };
const client = () =>
  createWikidataClientWithDefaults({ sleep: async () => undefined });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("enrichWithWikidata", () => {
  it("looks the titles up in two calls and saves the items with the titles in one", async () => {
    const seen: SeenQuery[] = [];
    mswServer.use(...wikidataHandlers(seen));
    mocks.findTitlesToLookUp.mockResolvedValue([
      {
        mediaId: "media-anime",
        type: "anime",
        sources: [{ scheme: "tmdb_tv", value: "1429" }],
      },
      {
        mediaId: "media-unknown",
        type: "movie",
        sources: [{ scheme: "tmdb_movie", value: "999999" }],
      },
    ]);

    const summary = await enrichWithWikidata({ db, wikidata: client() });

    expect(summary).toEqual({ found: 2, matched: 1, unknown: 1, items: 5 });
    expect(seen).toHaveLength(2);
    expect(mocks.saveWikidata).toHaveBeenCalledTimes(1);
    const saved = mocks.saveWikidata.mock.calls[0]?.[1];
    expect(saved.titles).toEqual([
      { mediaId: "media-anime", qid: animeQid },
      { mediaId: "media-unknown", qid: null },
    ]);
    const byQid = new Map(
      saved.items.map((item: { qid: string }) => [item.qid, item]),
    );
    // The title we hold keeps the format of our catalog, and gets the links of the lookup.
    expect(byQid.get(animeQid)).toMatchObject({
      format: "anime",
      franchises: [franchiseQid],
      basedOn: [mangaQid],
      ids: { tmdb_tv: "1429" },
    });
    expect(byQid.get(mangaQid)).toMatchObject({ format: "manga" });
    expect(byQid.get(filmQid)).toMatchObject({ format: "movie" });
    expect(byQid.get(franchiseQid)).toMatchObject({ format: "franchise" });
  });

  it("asks nothing when there is nothing to look up", async () => {
    const seen: SeenQuery[] = [];
    mswServer.use(...wikidataHandlers(seen));
    mocks.findTitlesToLookUp.mockResolvedValue([]);

    expect(await enrichWithWikidata({ db, wikidata: client() })).toEqual({
      found: 0,
      matched: 0,
      unknown: 0,
      items: 0,
    });
    expect(seen).toHaveLength(0);
    expect(mocks.saveWikidata).not.toHaveBeenCalled();
  });

  it("notes a title that has nothing to look up by without calling Wikidata", async () => {
    const seen: SeenQuery[] = [];
    mswServer.use(...wikidataHandlers(seen));
    mocks.findTitlesToLookUp.mockResolvedValue([
      { mediaId: "media-manga", type: "manga", sources: [] },
    ]);

    const summary = await enrichWithWikidata({ db, wikidata: client() });

    expect(summary).toMatchObject({ found: 1, matched: 0, unknown: 1 });
    expect(seen).toHaveLength(0);
    expect(mocks.saveWikidata).toHaveBeenCalledWith(db, {
      titles: [{ mediaId: "media-manga", qid: null }],
      items: [],
    });
  });

  it("saves nothing when Wikidata fails, so the same titles are tried again", async () => {
    const wikidata = {
      lookup: vi.fn().mockRejectedValue(new Error("down")),
      members: vi.fn(),
    };
    mocks.findTitlesToLookUp.mockResolvedValue([
      {
        mediaId: "m",
        type: "anime",
        sources: [{ scheme: "tmdb_tv", value: "1429" }],
      },
    ]);

    await expect(enrichWithWikidata({ db, wikidata })).rejects.toThrow("down");
    expect(mocks.saveWikidata).not.toHaveBeenCalled();
  });
});
