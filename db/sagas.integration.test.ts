import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveMedia } from "../server/db/media-store";
import {
  libraryEntries,
  mediaParts,
  sagas,
  sagaWikidataMembers,
} from "../server/db/schema";
import {
  findSagaSyncWork,
  getSagaBySlug,
  getSagaProgress,
  getSagasOfMedia,
  saveSagas,
} from "../server/db/sagas";
import { saveWikidata } from "../server/db/wikidata-store";
import type { NormalizedMedia } from "../server/providers/types";
import type { WikidataItem } from "../server/providers/wikidata/map";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE media_items, wikidata_items, wikidata_links, sagas, users RESTART IDENTITY CASCADE`,
  );
});

const anime: NormalizedMedia = {
  type: "anime",
  title: "Attack on Titan",
  originalTitle: null,
  year: 2013,
  synopsis: {},
  imageUrl: null,
  status: "finished",
  popularity: 1,
  externalId: { provider: "tmdb", id: "tv/1429" },
};

const mangaId = "00000000-0000-4000-8000-000000000001";
const manga: NormalizedMedia = {
  ...anime,
  type: "manga",
  title: "Shingeki",
  externalId: { provider: "mangadex", id: mangaId },
  crossIds: { mal: "23390", anilist: "53390" },
};

const item = (
  overrides: Partial<WikidataItem> & { qid: string },
): WikidataItem => ({
  labels: {},
  format: "other",
  ids: {},
  franchises: [],
  basedOn: [],
  year: null,
  detailed: true,
  ...overrides,
});

const entry = {
  slug: "attack-on-titan",
  titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
  hash: "h1",
  members: ["Q1", "Q2", "Q3"],
};

describe("findSagaSyncWork", () => {
  it("asks for a saga that was never saved, and for each work that was never described", async () => {
    const work = await findSagaSyncWork(
      db,
      [{ slug: "attack-on-titan", hash: "h1" }],
      ["Q1", "Q2"],
    );

    expect(work).toEqual({
      changedSlugs: ["attack-on-titan"],
      missingQids: ["Q1", "Q2"],
    });
  });

  it("has nothing to do once a saga is saved with the same entry and its works are described", async () => {
    await saveSagas(db, [entry]);
    await saveWikidata(db, {
      titles: [],
      items: ["Q1", "Q2", "Q3"].map((qid) => item({ qid })),
    });

    expect(
      await findSagaSyncWork(
        db,
        [{ slug: entry.slug, hash: "h1" }],
        entry.members,
      ),
    ).toEqual({ changedSlugs: [], missingQids: [] });
  });

  it("asks again when the entry changed, and when a work was only looked up and not described", async () => {
    await saveSagas(db, [entry]);
    await saveWikidata(db, {
      titles: [],
      items: [
        item({ qid: "Q1" }),
        // Found by a lookup of a title: no year and no description yet.
        item({ qid: "Q2", detailed: false }),
      ],
    });

    // Q3 is a member of the saga that is saved, and nothing has described it: since SAG-92 the
    // works of every saga in the database are asked for, not only the ones of the curated file.
    expect(
      await findSagaSyncWork(
        db,
        [{ slug: entry.slug, hash: "h2" }],
        ["Q1", "Q2"],
      ),
    ).toEqual({
      changedSlugs: ["attack-on-titan"],
      missingQids: ["Q2", "Q3"],
    });
  });
});

describe("saveSagas", () => {
  const members = async () =>
    (
      await db
        .select({
          qid: sagaWikidataMembers.qid,
          position: sagaWikidataMembers.position,
        })
        .from(sagaWikidataMembers)
    ).sort((a, b) => a.position - b.position);

  it("saves the saga with its names and its members in the order of the story", async () => {
    await saveSagas(db, [entry]);

    expect(await db.select().from(sagas)).toMatchObject([
      {
        slug: "attack-on-titan",
        title: "Attack on Titan",
        titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
        sourceHash: "h1",
      },
    ]);
    expect(await members()).toEqual([
      { qid: "Q1", position: 0 },
      { qid: "Q2", position: 1 },
      { qid: "Q3", position: 2 },
    ]);
  });

  it("updates the saga in place when its entry changes: works move, join and leave", async () => {
    await saveSagas(db, [entry]);
    const [before] = await db.select().from(sagas);

    await saveSagas(db, [
      { ...entry, hash: "h2", members: ["Q3", "Q1", "Q4"] },
    ]);

    const rows = await db.select().from(sagas);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before?.id, sourceHash: "h2" });
    expect(await members()).toEqual([
      { qid: "Q3", position: 0 },
      { qid: "Q1", position: 1 },
      { qid: "Q4", position: 2 },
    ]);
  });

  it("saves several sagas in one go and leaves the others alone", async () => {
    await saveSagas(db, [entry]);
    await saveSagas(db, [
      {
        slug: "other",
        titles: { es: "Otra", en: "Other" },
        hash: "x",
        members: ["Q9"],
      },
    ]);

    expect(await db.select().from(sagas)).toHaveLength(2);
    expect(await members()).toHaveLength(4);
  });

  it("does nothing for an empty list, and drops the members with the saga", async () => {
    await saveSagas(db, []);
    expect(await db.select().from(sagas)).toEqual([]);

    await saveSagas(db, [entry]);
    await db.execute(sql`DELETE FROM sagas`);
    expect(await members()).toEqual([]);
  });

  it("refuses a member that is not an item id, and a slug used twice", async () => {
    await saveSagas(db, [entry]);

    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO saga_wikidata_members (saga_id, qid, position)
                SELECT id, 'nope', 9 FROM sagas`,
          ),
        )
      ).constraint,
    ).toBe("saga_wikidata_members_qid_check");
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO sagas (slug, title) VALUES ('attack-on-titan', 'Again')`,
          ),
        )
      ).code,
    ).toBe("23505");
  });
});

describe("getSagaBySlug and getSagasOfMedia", () => {
  /** The saga of an anime, its manga (both in the catalog) and a game that only Wikidata knows. */
  async function setUp() {
    const animeId = await saveMedia(db, anime);
    const mangaMediaId = await saveMedia(db, manga);
    await saveSagas(db, [entry]);
    await saveWikidata(db, {
      titles: [],
      items: [
        item({
          qid: "Q1",
          labels: { es: "Ataque a los Titanes" },
          format: "manga",
          ids: { mal_manga: "23390", anilist_manga: "53390" },
          year: 2009,
        }),
        item({
          qid: "Q2",
          labels: { en: "Attack on Titan" },
          format: "anime",
          ids: { tmdb_tv: "1429" },
          year: 2013,
        }),
        item({
          qid: "Q3",
          labels: { en: "The game" },
          format: "game",
          year: 2016,
        }),
      ],
    });
    return { animeId, mangaMediaId };
  }

  it("lists the works in the order of the story, matching the ones the catalog holds", async () => {
    const { animeId, mangaMediaId } = await setUp();

    const page = await getSagaBySlug(db, "attack-on-titan");

    expect(page).toMatchObject({
      slug: "attack-on-titan",
      title: "Attack on Titan",
      titles: { es: "Ataque a los Titanes" },
    });
    expect(page?.members.map((member) => member.qid)).toEqual([
      "Q1",
      "Q2",
      "Q3",
    ]);
    expect(page?.members[0]).toMatchObject({
      format: "manga",
      year: 2009,
      media: { id: mangaMediaId, type: "manga" },
    });
    expect(page?.members[1]?.media).toMatchObject({
      id: animeId,
      type: "anime",
    });
    expect(page?.members[2]).toMatchObject({ format: "game", media: null });
  });

  it("leaves out a work that has not been described yet, and is null when none has", async () => {
    await saveSagas(db, [entry]);
    expect(await getSagaBySlug(db, "attack-on-titan")).toBeNull();

    await saveWikidata(db, {
      titles: [],
      items: [
        item({ qid: "Q2", year: 2013 }),
        item({ qid: "Q3", detailed: false }),
      ],
    });
    expect(
      (await getSagaBySlug(db, "attack-on-titan"))?.members.map((m) => m.qid),
    ).toEqual(["Q2"]);
    expect(await getSagaBySlug(db, "no-such-saga")).toBeNull();
  });

  it("finds the sagas of a title, by its ids, and of one that was looked up", async () => {
    const { animeId, mangaMediaId } = await setUp();
    const lonely = await saveMedia(db, {
      ...anime,
      externalId: { provider: "tmdb", id: "tv/77" },
    });

    expect(await getSagasOfMedia(db, animeId)).toMatchObject([
      { slug: "attack-on-titan", title: "Attack on Titan" },
    ]);
    expect(await getSagasOfMedia(db, mangaMediaId)).toHaveLength(1);
    expect(await getSagasOfMedia(db, lonely)).toEqual([]);

    // A title Wikidata resolved to the item is part of the saga whatever its ids say.
    await saveWikidata(db, {
      titles: [{ mediaId: lonely, qid: "Q3" }],
      items: [],
    });
    expect(await getSagasOfMedia(db, lonely)).toHaveLength(1);
  });

  it("lists a title once when two of its items are in the same saga", async () => {
    const { animeId } = await setUp();
    await saveWikidata(db, {
      titles: [{ mediaId: animeId, qid: "Q3" }],
      items: [],
    });

    expect(await getSagasOfMedia(db, animeId)).toHaveLength(1);
  });
});

describe("getSagaProgress", () => {
  it("gives the status, the progress and the total of the titles the person holds", async () => {
    const user = await newUser();
    const other = await newUser();
    const animeId = await saveMedia(db, anime);
    const mangaMediaId = await saveMedia(db, manga);
    // Two seasons of 2 episodes, and a special that does not count (season 0).
    const [s0, s1, s2] = await db
      .insert(mediaParts)
      .values([
        { mediaId: animeId, kind: "season", number: 0 },
        { mediaId: animeId, kind: "season", number: 1 },
        { mediaId: animeId, kind: "season", number: 2 },
      ])
      .returning();
    await db.insert(mediaParts).values(
      [s0, s1, s1, s2, s2].map((season, index) => ({
        mediaId: animeId,
        kind: "episode" as const,
        parentId: season?.id,
        number: index + 1,
      })),
    );
    await db.insert(libraryEntries).values([
      { userId: user.id, mediaId: animeId, status: "in_progress", progress: 3 },
      {
        userId: user.id,
        mediaId: mangaMediaId,
        status: "in_progress",
        progress: 10,
        progressUnit: "volumes",
        progressTotal: 34,
      },
      { userId: other.id, mediaId: animeId, status: "completed", progress: 4 },
    ]);

    const progress = await getSagaProgress(db, user.id, [
      animeId,
      mangaMediaId,
    ]);

    expect(progress.get(animeId)).toEqual({
      status: "in_progress",
      progress: 3,
      total: 4,
    });
    expect(progress.get(mangaMediaId)).toEqual({
      status: "in_progress",
      progress: 10,
      total: 34,
    });
  });

  it("never gives another person's entries, and is empty for no titles or none held", async () => {
    const user = await newUser();
    const other = await newUser();
    const animeId = await saveMedia(db, anime);
    await db
      .insert(libraryEntries)
      .values({ userId: other.id, mediaId: animeId, status: "completed" });

    expect(await getSagaProgress(db, user.id, [animeId])).toEqual(new Map());
    expect(await getSagaProgress(db, user.id, [])).toEqual(new Map());
  });

  it("says no total for a title with no episodes in the catalog and no edition total", async () => {
    const user = await newUser();
    const mangaMediaId = await saveMedia(db, manga);
    await db
      .insert(libraryEntries)
      .values({ userId: user.id, mediaId: mangaMediaId, status: "planned" });

    expect(
      (await getSagaProgress(db, user.id, [mangaMediaId])).get(mangaMediaId),
    ).toEqual({ status: "planned", progress: 0, total: null });
  });
});
