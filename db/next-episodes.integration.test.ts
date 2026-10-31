import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findShowsToCheck,
  getNextEpisode,
  postponeShows,
  saveNextEpisodes,
  type NextEpisodeToSave,
} from "../server/db/next-episodes";
import { saveMedia } from "../server/db/media-store";
import {
  libraryEntries,
  mediaItems,
  mediaNextEpisode,
  mediaWikidata,
} from "../server/db/schema";
import { findTitlesToLookUp, saveWikidata } from "../server/db/wikidata-store";
import type { NormalizedMedia } from "../server/providers/types";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE media_items, wikidata_items, users RESTART IDENTITY CASCADE`,
  );
});

let counter = 0;
async function addSeries(
  overrides: Partial<NormalizedMedia> = {},
): Promise<string> {
  counter += 1;
  return saveMedia(db, {
    type: "series",
    title: `Series ${counter}`,
    originalTitle: null,
    year: 2020,
    synopsis: {},
    imageUrl: null,
    status: "ongoing",
    popularity: 1,
    externalId: { provider: "tmdb", id: `tv/${counter}` },
    ...overrides,
  });
}

/** A title Wikidata resolved, with the id of its show in TVmaze when it has one. */
async function resolved(mediaId: string, tvmazeId: number | null) {
  await saveWikidata(db, {
    titles: [
      {
        mediaId,
        qid: `Q${mediaId.slice(-6).replace(/[^0-9]/g, "1")}`,
        tvmazeId,
      },
    ],
    items: [],
  });
}

const inDays = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const answer = (
  mediaId: string,
  overrides: Partial<NextEpisodeToSave> = {},
): NextEpisodeToSave => ({
  mediaId,
  tvmazeId: 83,
  showStatus: "Running",
  airDate: null,
  airStamp: null,
  season: null,
  number: null,
  episodeName: null,
  nextCheckAt: inDays(7),
  ...overrides,
});

describe("findShowsToCheck (SAG-90)", () => {
  it("lists a series with the id of its show that was never asked about", async () => {
    const id = await addSeries();
    await resolved(id, 83);

    expect(await findShowsToCheck(db, 10)).toEqual([
      { mediaId: id, tvmazeId: 83 },
    ]);
  });

  it("leaves out what has no show in TVmaze: no id, a movie, a book", async () => {
    const without = await addSeries();
    await resolved(without, null);
    const movie = await addSeries({
      type: "movie",
      externalId: { provider: "tmdb", id: "movie/5" },
    });
    await resolved(movie, 90);
    const notLookedUp = await addSeries();
    expect(notLookedUp).not.toBe(without);

    expect(await findShowsToCheck(db, 10)).toEqual([]);
  });

  it("takes anime too", async () => {
    const anime = await addSeries({ type: "anime" });
    await resolved(anime, 919);

    expect(
      (await findShowsToCheck(db, 10)).map((show) => show.tvmazeId),
    ).toEqual([919]);
  });

  it("waits for the time of each show, and asks again when it has come", async () => {
    const id = await addSeries();
    await resolved(id, 83);
    await saveNextEpisodes(db, [answer(id, { nextCheckAt: inDays(3) })]);
    expect(await findShowsToCheck(db, 10)).toEqual([]);

    await db.execute(
      sql`UPDATE media_next_episode SET next_check_at = now() - interval '1 minute'`,
    );
    expect(await findShowsToCheck(db, 10)).toHaveLength(1);
  });

  it("puts the series in a library first, then the ones never asked about, then the ones waiting longest, and respects the limit", async () => {
    const user = await newUser();
    const plain = await addSeries();
    const wanted = await addSeries();
    const waiting = await addSeries();
    for (const [index, id] of [plain, wanted, waiting].entries()) {
      await resolved(id, 100 + index);
    }
    await db
      .insert(libraryEntries)
      .values({ userId: user.id, mediaId: wanted, status: "planned" });
    await saveNextEpisodes(db, [
      answer(waiting, { tvmazeId: 102, nextCheckAt: inDays(-5) }),
    ]);

    const all = await findShowsToCheck(db, 10);
    // The one in a library first, then the one never asked about, then the one that waited.
    expect(all.map((show) => show.mediaId)).toEqual([wanted, plain, waiting]);
    expect(await findShowsToCheck(db, 1)).toEqual([
      { mediaId: wanted, tvmazeId: 101 },
    ]);
  });
});

describe("saveNextEpisodes and getNextEpisode (SAG-90)", () => {
  it("saves the next episode of each show in one statement, and updates what is there", async () => {
    const a = await addSeries();
    const b = await addSeries();
    await saveNextEpisodes(db, [
      answer(a, {
        airDate: "2099-11-14",
        airStamp: "2099-11-15T01:00:00.000Z",
        season: 2,
        number: 5,
        episodeName: "The Fifth",
      }),
      answer(b, { tvmazeId: 919, showStatus: "Ended" }),
    ]);

    expect(await db.select().from(mediaNextEpisode)).toHaveLength(2);
    expect(await getNextEpisode(db, a)).toEqual({
      airDate: "2099-11-14",
      season: 2,
      number: 5,
      name: "The Fifth",
    });
    expect(await getNextEpisode(db, b)).toBeNull();

    await saveNextEpisodes(db, [
      answer(a, { airDate: "2099-12-01", season: 2, number: 6 }),
    ]);
    expect(await db.select().from(mediaNextEpisode)).toHaveLength(2);
    expect(await getNextEpisode(db, a)).toEqual({
      airDate: "2099-12-01",
      season: 2,
      number: 6,
      name: null,
    });
  });

  it("does nothing for an empty list", async () => {
    await saveNextEpisodes(db, []);
    await postponeShows(db, [], new Date());

    expect(await db.select().from(mediaNextEpisode)).toEqual([]);
  });

  it("shows no next episode for a date that is long past, and one a day old still shows", async () => {
    const old = await addSeries();
    const yesterday = await addSeries();
    const today = new Date().toISOString().slice(0, 10);
    const dayBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await saveNextEpisodes(db, [
      answer(old, { airDate: "2020-01-01" }),
      answer(yesterday, { airDate: dayBefore }),
    ]);

    expect(await getNextEpisode(db, old)).toBeNull();
    expect((await getNextEpisode(db, yesterday))?.airDate).toBe(dayBefore);
    expect(today >= dayBefore).toBe(true);
  });

  it("gives null for a title with no row", async () => {
    expect(await getNextEpisode(db, await addSeries())).toBeNull();
  });

  it("goes with the title when the title is deleted", async () => {
    const id = await addSeries();
    await saveNextEpisodes(db, [answer(id, { airDate: "2099-01-01" })]);

    await db.delete(mediaItems).where(eq(mediaItems.id, id));

    expect(await db.select().from(mediaNextEpisode)).toEqual([]);
  });

  it("refuses a negative season or number, through the table", async () => {
    const id = await addSeries();

    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO media_next_episode (media_id, tvmaze_id, season, next_check_at)
                VALUES (${id}::uuid, 1, -1, now())`,
          ),
        )
      ).constraint,
    ).toBe("media_next_episode_numbers_check");
  });
});

describe("postponeShows (SAG-90)", () => {
  it("puts a show off without losing what was known of its next episode", async () => {
    const id = await addSeries();
    await saveNextEpisodes(db, [
      answer(id, {
        airDate: "2099-11-14",
        season: 1,
        number: 2,
        nextCheckAt: inDays(-1),
      }),
    ]);

    await postponeShows(db, [{ mediaId: id, tvmazeId: 83 }], inDays(1));

    expect(await findShowsToCheck(db, 10)).toEqual([]);
    expect(await getNextEpisode(db, id)).toMatchObject({
      airDate: "2099-11-14",
      season: 1,
      number: 2,
    });
  });

  it("makes a row for a show that had none, so it is not asked about on every run", async () => {
    const id = await addSeries();
    await resolved(id, 83);
    expect(await findShowsToCheck(db, 10)).toHaveLength(1);

    await postponeShows(db, [{ mediaId: id, tvmazeId: 83 }], inDays(1));

    expect(await findShowsToCheck(db, 10)).toEqual([]);
    expect(await getNextEpisode(db, id)).toBeNull();
  });
});

describe("the id of the show in TVmaze, in the Wikidata job (SAG-90)", () => {
  it("is saved with the title, and a later answer with none never erases it", async () => {
    const id = await addSeries();
    await saveWikidata(db, {
      titles: [{ mediaId: id, qid: "Q1", tvmazeId: 919 }],
      items: [],
    });
    expect((await db.select().from(mediaWikidata))[0]).toMatchObject({
      qid: "Q1",
      tvmazeId: 919,
    });
    expect(
      (await db.select().from(mediaWikidata))[0]?.tvmazeCheckedAt,
    ).not.toBeNull();

    await saveWikidata(db, {
      titles: [{ mediaId: id, qid: "Q1", tvmazeId: null }],
      items: [],
    });
    expect((await db.select().from(mediaWikidata))[0]?.tvmazeId).toBe(919);
  });

  it("looks a series up once more when it was found before its show was read, and not again", async () => {
    const series = await addSeries();
    const movie = await addSeries({
      type: "movie",
      externalId: { provider: "tmdb", id: "movie/9" },
    });
    // Found by an older run, which did not read the show: no check date for it.
    await db.insert(mediaWikidata).values([
      { mediaId: series, qid: "Q10" },
      { mediaId: movie, qid: "Q11" },
    ]);

    expect(
      (await findTitlesToLookUp(db, 10)).map((row) => row.mediaId),
    ).toEqual([series]);

    await saveWikidata(db, {
      titles: [{ mediaId: series, qid: "Q10", tvmazeId: null }],
      items: [],
    });
    expect(await findTitlesToLookUp(db, 10)).toEqual([]);
  });

  it("does not look a book or a manga up again for it", async () => {
    const book = await addSeries({
      type: "book",
      externalId: { provider: "open_library", id: "OL1W" },
    });
    await db.insert(mediaWikidata).values({ mediaId: book, qid: "Q12" });

    expect(await findTitlesToLookUp(db, 10)).toEqual([]);
  });
});

describe("the table of next episodes", () => {
  it("is not part of what a person owns: another person's library does not change it", async () => {
    const id = await addSeries();
    const user = await newUser();
    await saveNextEpisodes(db, [answer(id, { airDate: "2099-01-01" })]);

    await db
      .insert(libraryEntries)
      .values({ userId: user.id, mediaId: id, status: "planned" });
    await db.execute(sql`DELETE FROM users`);

    expect(await db.select().from(mediaNextEpisode)).toHaveLength(1);
  });
});
