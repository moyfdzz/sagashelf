import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CuratedSaga } from "../sagas/curated";
import { hashOf, itemsPerRun, syncSagas } from "./sync-sagas";

const mocks = vi.hoisted(() => ({
  findSagaSyncWork: vi.fn(),
  saveSagas: vi.fn(),
  saveWikidata: vi.fn(),
}));

vi.mock("../db/sagas", () => ({
  findSagaSyncWork: mocks.findSagaSyncWork,
  saveSagas: mocks.saveSagas,
}));
vi.mock("../db/wikidata-store", () => ({ saveWikidata: mocks.saveWikidata }));

const db = { execute: vi.fn() };
const saga = (slug: string, members: string[]): CuratedSaga => ({
  slug,
  titles: { es: slug, en: slug },
  members,
});
const sagas = [saga("one", ["Q1", "Q2"]), saga("two", ["Q2", "Q3"])];

const wikidata = () => ({
  lookup: vi.fn(),
  members: vi.fn().mockResolvedValue([{ qid: "Q1" }, { qid: "Q2" }]),
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("hashOf", () => {
  it("changes when the entry changes and not otherwise", async () => {
    const same = await hashOf(saga("one", ["Q1", "Q2"]));

    expect(await hashOf(saga("one", ["Q1", "Q2"]))).toBe(same);
    expect(await hashOf(saga("one", ["Q2", "Q1"]))).not.toBe(same);
    expect(same).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("syncSagas", () => {
  it("costs one query when there is nothing to do", async () => {
    mocks.findSagaSyncWork.mockResolvedValue({
      changedSlugs: [],
      missingQids: [],
    });
    const client = wikidata();

    const summary = await syncSagas({ db, wikidata: client }, sagas);

    expect(summary).toEqual({ sagas: 0, items: 0 });
    expect(mocks.saveSagas).not.toHaveBeenCalled();
    expect(client.members).not.toHaveBeenCalled();
    expect(mocks.saveWikidata).not.toHaveBeenCalled();
  });

  it("asks the database about every saga and every work once", async () => {
    mocks.findSagaSyncWork.mockResolvedValue({
      changedSlugs: [],
      missingQids: [],
    });

    await syncSagas({ db, wikidata: wikidata() }, sagas);

    const [, sent, qids] = mocks.findSagaSyncWork.mock.calls[0] ?? [];
    expect(sent.map((entry: { slug: string }) => entry.slug)).toEqual([
      "one",
      "two",
    ]);
    expect(qids).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("saves only the sagas that changed, then describes the works that are missing", async () => {
    mocks.findSagaSyncWork.mockResolvedValue({
      changedSlugs: ["two"],
      missingQids: ["Q1", "Q2"],
    });
    const client = wikidata();

    const summary = await syncSagas({ db, wikidata: client }, sagas);

    expect(summary).toEqual({ sagas: 1, items: 2 });
    expect(mocks.saveSagas).toHaveBeenCalledWith(db, [
      {
        slug: "two",
        titles: { es: "two", en: "two" },
        hash: await hashOf(sagas[1] as CuratedSaga),
        members: ["Q2", "Q3"],
      },
    ]);
    expect(client.members).toHaveBeenCalledWith(
      [],
      ["Q1", "Q2"],
      expect.anything(),
    );
    expect(mocks.saveWikidata).toHaveBeenCalledWith(db, {
      titles: [],
      items: [{ qid: "Q1" }, { qid: "Q2" }],
    });
  });

  it("asks for a bounded number of works in a run, and the rest on the next ones", async () => {
    const qids = Array.from(
      { length: itemsPerRun + 50 },
      (_, i) => `Q${i + 1}`,
    );
    mocks.findSagaSyncWork.mockResolvedValue({
      changedSlugs: [],
      missingQids: qids,
    });
    const client = wikidata();

    await syncSagas({ db, wikidata: client }, [saga("big", qids)]);

    expect(client.members.mock.calls[0]?.[1]).toHaveLength(itemsPerRun);
  });

  it("keeps the sagas it saved when Wikidata fails, so the works are asked for again next run", async () => {
    mocks.findSagaSyncWork.mockResolvedValue({
      changedSlugs: ["one"],
      missingQids: ["Q1"],
    });
    const client = {
      lookup: vi.fn(),
      members: vi.fn().mockRejectedValue(new Error("down")),
    };

    await expect(syncSagas({ db, wikidata: client }, sagas)).rejects.toThrow(
      "down",
    );

    expect(mocks.saveSagas).toHaveBeenCalledTimes(1);
    expect(mocks.saveWikidata).not.toHaveBeenCalled();
  });
});
