import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveMedia, saveParts } from "../server/db/media-store";
import { libraryEntries, libraryViewings } from "../server/db/schema";
import { getStats } from "../server/db/stats";
import type { NormalizedMedia } from "../server/providers/types";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

let counter = 0;
async function addMedia(
  overrides: Partial<NormalizedMedia> & { episodes?: number } = {},
): Promise<string> {
  counter += 1;
  const { episodes = 0, ...media } = overrides;
  const id = await saveMedia(db, {
    type: "movie",
    title: `Title ${counter}`,
    originalTitle: null,
    year: 2014,
    synopsis: {},
    imageUrl: null,
    status: "finished",
    popularity: 1,
    externalId: { provider: "tmdb", id: `movie/${counter}` },
    ...media,
  });
  if (episodes > 0) {
    await saveParts(db, id, [
      { kind: "season", number: 1, title: null, airDate: null },
      ...Array.from({ length: episodes }, (_, index) => ({
        kind: "episode" as const,
        number: index + 1,
        title: null,
        airDate: null,
        seasonNumber: 1,
      })),
    ]);
  }
  return id;
}

async function addEntry(
  userId: string,
  mediaId: string,
  values: Partial<typeof libraryEntries.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(libraryEntries)
    .values({ userId, mediaId, ...values })
    .returning({ id: libraryEntries.id });
  if (!row) throw new Error("The entry was not created");
  return row.id;
}

describe("the statistics of a person (SAG-61, SAG-85)", () => {
  it("is all zeros and empty lists for a person with nothing", async () => {
    const user = await newUser();

    expect(await getStats(db, user.id, "es")).toEqual({
      entries: 0,
      completed: 0,
      episodesWatched: 0,
      rewatches: 0,
      minutesWatched: 0,
      minutesPlanned: 0,
      unknownRuntime: 0,
      pagesRead: 0,
      chaptersRead: 0,
      volumesRead: 0,
      averageScore: null,
      scored: 0,
      scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      byType: {},
      byStatus: {},
      releasedByYear: [],
      finishedByYear: [],
      finishedByMonth: [],
      undatedFinished: 0,
      best: [],
      minutesByType: {},
      scoreByType: {},
      mostWatched: [],
      mostRewatched: [],
      finishTime: { medianDays: null, counted: 0, skipped: 0 },
      oldestPlanned: [],
      byGenre: [],
      withoutGenre: 0,
    });
  });

  describe("with a library", () => {
    async function library() {
      const user = await newUser();

      // A movie of 120 minutes, completed and watched once before: two viewings.
      const movie = await addMedia({
        runtimeMinutes: 120,
        year: 2014,
        genres: ["action", "sci_fi"],
      });
      const movieEntry = await addEntry(user.id, movie, {
        status: "completed",
        score: 8,
        startedAt: "2025-03-01",
        finishedAt: "2025-03-10",
      });
      await db.insert(libraryViewings).values({
        entryId: movieEntry,
        startedOn: "2024-05-01",
        finishedOn: "2024-05-02",
      });

      // A series of 40 minutes and 3 episodes, two of them seen.
      const watching = await addMedia({
        type: "series",
        runtimeMinutes: 40,
        year: 2020,
        episodes: 3,
        genres: ["drama"],
      });
      await addEntry(user.id, watching, { status: "in_progress", progress: 2 });

      // A series of 50 minutes and 3 episodes, completed, watched once before, with no dates.
      const done = await addMedia({
        type: "anime",
        runtimeMinutes: 50,
        year: 2020,
        episodes: 3,
        genres: ["action", "drama"],
      });
      const doneEntry = await addEntry(user.id, done, {
        status: "completed",
        progress: 3,
        score: 10,
      });
      await db.insert(libraryViewings).values({ entryId: doneEntry });

      // Two movies that are pending: one with a length, one without.
      await addEntry(
        user.id,
        await addMedia({ runtimeMinutes: 100, year: 2021, genres: ["comedy"] }),
      );
      await addEntry(user.id, await addMedia({ year: null }));

      // A book of 300 pages, completed.
      await addEntry(
        user.id,
        await addMedia({
          type: "book",
          year: 2014,
          genres: [],
          externalId: { provider: "open_library", id: "OL1W" },
        }),
        {
          status: "completed",
          progress: 300,
          progressUnit: "pages",
          progressTotal: 300,
          score: 8,
          finishedAt: "2025-06-15",
        },
      );
      return user;
    }

    it("counts what was watched, counting each earlier viewing", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.entries).toBe(6);
      expect(stats.completed).toBe(3);
      // 2 seen of the series, and 3 of the anime now plus 3 of the earlier viewing.
      expect(stats.episodesWatched).toBe(2 + 3 + 3);
      expect(stats.rewatches).toBe(2);
      // 120 min x 2 viewings, 40 min x 2 episodes, 50 min x 6 episodes.
      expect(stats.minutesWatched).toBe(240 + 80 + 300);
      expect(stats.pagesRead).toBe(300);
      expect(stats.chaptersRead).toBe(0);
    });

    it("counts the time that is pending, and the titles that have no length", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.minutesPlanned).toBe(100);
      expect(stats.unknownRuntime).toBe(1);
    });

    it("averages the scores and counts how many got each one", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.scored).toBe(3);
      expect(stats.averageScore).toBeCloseTo((8 + 10 + 8) / 3);
      expect(stats.scores).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 0, 1]);
    });

    it("groups by type, by status and by year of release", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.byType).toEqual({
        movie: 3,
        series: 1,
        anime: 1,
        book: 1,
      });
      expect(stats.byStatus).toEqual({
        completed: 3,
        in_progress: 1,
        planned: 2,
      });
      // The pending movie with no year is left out.
      expect(stats.releasedByYear).toEqual([
        { year: 2014, count: 2 },
        { year: 2020, count: 2 },
        { year: 2021, count: 1 },
      ]);
    });

    it("places each finished viewing in its year and month, and counts the ones with no date apart", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      // The movie (March 2025) and its earlier viewing (May 2024), and the book (June 2025).
      expect(stats.finishedByYear).toEqual([
        { year: 2024, count: 1 },
        { year: 2025, count: 2 },
      ]);
      expect(stats.finishedByMonth).toEqual([
        { year: 2024, month: 5, count: 1 },
        { year: 2025, month: 3, count: 1 },
        { year: 2025, month: 6, count: 1 },
      ]);
      // The anime has no finish date, and neither has its earlier viewing.
      expect(stats.undatedFinished).toBe(2);
    });

    it("lists the best scored first, the latest changed first among equals", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.best.map((entry) => entry.score)).toEqual([10, 8, 8]);
      expect(stats.best[0]).toMatchObject({ type: "anime", year: 2020 });
    });

    it("adds up the minutes of each type that has a length", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      // The book has pages, not minutes, and the planned movies were not watched.
      expect(stats.minutesByType).toEqual({
        anime: 300,
        movie: 240,
        series: 80,
      });
    });

    it("averages the score of each type and counts the titles it comes from", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.scoreByType).toEqual({
        movie: { average: 8, scored: 1 },
        anime: { average: 10, scored: 1 },
        book: { average: 8, scored: 1 },
      });
    });

    it("lists the titles with the most minutes watched, the most first", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.mostWatched.map((entry) => entry.minutes)).toEqual([
        300, 240, 80,
      ]);
      expect(stats.mostWatched[0]).toMatchObject({ type: "anime", year: 2020 });
    });

    it("lists what was watched again, with the minutes those viewings took", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      // Both were watched once more: the anime's 3 episodes of 50 minutes, then the movie's 120.
      expect(
        stats.mostRewatched.map((entry) => [
          entry.type,
          entry.rewatches,
          entry.minutes,
        ]),
      ).toEqual([
        ["anime", 1, 150],
        ["movie", 1, 120],
      ]);
    });

    it("takes the median of the days from the start to the finish, and counts the viewings left out", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      // 9 days for the movie, 1 for its earlier viewing; the anime, its earlier viewing and the
      // book lack a start or a finish date.
      expect(stats.finishTime).toEqual({
        medianDays: 5,
        counted: 2,
        skipped: 3,
      });
    });

    it("lists the planned titles that were added first", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      expect(stats.oldestPlanned.map((entry) => entry.year)).toEqual([
        2021,
        null,
      ]);
      expect(stats.oldestPlanned[0]?.addedOn).toMatch(
        /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
      );
    });

    it("adds up each genre: its titles, its minutes and its scores, a title with two genres in both (SAG-86)", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      // Action: the movie (240 min, score 8) and the anime (300 min, score 10). Drama: the series
      // being watched (80 min, no score) and the anime. Science fiction: the movie alone.
      expect(stats.byGenre).toEqual([
        {
          genre: "action",
          titles: 2,
          minutes: 540,
          pagesRead: 0,
          chaptersRead: 0,
          volumesRead: 0,
          scored: 2,
          averageScore: 9,
        },
        {
          genre: "drama",
          titles: 2,
          minutes: 380,
          pagesRead: 0,
          chaptersRead: 0,
          volumesRead: 0,
          scored: 1,
          averageScore: 10,
        },
        {
          genre: "sci_fi",
          titles: 1,
          minutes: 240,
          pagesRead: 0,
          chaptersRead: 0,
          volumesRead: 0,
          scored: 1,
          averageScore: 8,
        },
      ]);
    });

    it("does not count a planned title in any genre, and counts what is not planned that has none (SAG-86)", async () => {
      const user = await library();

      const stats = await getStats(db, user.id, "es");

      // The planned movie is of the genre comedy, and nothing else is.
      expect(stats.byGenre.map((entry) => entry.genre)).not.toContain("comedy");
      // The book says "asked, none fits". The planned movie with no genres is planned, so it is not
      // counted either.
      expect(stats.withoutGenre).toBe(1);
    });

    it("never counts the genres of another person", async () => {
      const user = await library();
      const other = await newUser();
      await addEntry(
        other.id,
        await addMedia({ runtimeMinutes: 90, genres: ["action", "western"] }),
        { status: "completed", score: 1 },
      );

      const mine = await getStats(db, user.id, "es");
      const theirs = await getStats(db, other.id, "es");

      expect(
        mine.byGenre.find((entry) => entry.genre === "action"),
      ).toMatchObject({
        titles: 2,
        minutes: 540,
      });
      expect(mine.byGenre.map((entry) => entry.genre)).not.toContain("western");
      expect(theirs.byGenre.map((entry) => entry.genre)).toEqual([
        "action",
        "western",
      ]);
      expect(theirs.byGenre[0]).toMatchObject({ titles: 1, minutes: 90 });
    });

    it("gives the title in the language of the visitor", async () => {
      const user = await newUser();
      const id = await addMedia({
        title: "Interestelar",
        titles: { es: "Interestelar", en: "Interstellar" },
      });
      await addEntry(user.id, id, { score: 9 });

      expect((await getStats(db, user.id, "en")).best[0]?.title).toBe(
        "Interstellar",
      );
      expect((await getStats(db, user.id, "es")).best[0]?.title).toBe(
        "Interestelar",
      );
    });

    it("never counts the entries of another person", async () => {
      const user = await library();
      const other = await newUser();
      await addEntry(other.id, await addMedia({ runtimeMinutes: 90 }), {
        status: "completed",
        score: 1,
        finishedAt: "2026-01-01",
      });

      const mine = await getStats(db, user.id, "es");
      const theirs = await getStats(db, other.id, "es");

      expect(mine.entries).toBe(6);
      expect(mine.scores[0]).toBe(0);
      expect(mine.mostWatched.map((entry) => entry.minutes)).not.toContain(90);
      expect(mine.finishTime.counted).toBe(2);
      expect(theirs.entries).toBe(1);
      expect(theirs.minutesWatched).toBe(90);
      expect(theirs.best).toHaveLength(1);
      expect(theirs.mostWatched).toHaveLength(1);
      expect(theirs.minutesByType).toEqual({ movie: 90 });
    });
  });

  it("keeps the ten titles with the most time and the five oldest planned", async () => {
    const user = await newUser();
    for (let minutes = 1; minutes <= 12; minutes += 1) {
      await addEntry(user.id, await addMedia({ runtimeMinutes: minutes }), {
        status: "completed",
      });
    }
    for (let index = 0; index < 7; index += 1) {
      await addEntry(user.id, await addMedia({ year: 2000 + index }));
    }

    const stats = await getStats(db, user.id, "es");

    expect(stats.mostWatched.map((entry) => entry.minutes)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(stats.oldestPlanned.map((entry) => entry.year)).toEqual([
      2000, 2001, 2002, 2003, 2004,
    ]);
  });

  it("gives the lists in the language of the visitor", async () => {
    const user = await newUser();
    await addEntry(
      user.id,
      await addMedia({
        runtimeMinutes: 100,
        title: "Interestelar",
        titles: { es: "Interestelar", en: "Interstellar" },
      }),
      { status: "completed" },
    );

    expect((await getStats(db, user.id, "en")).mostWatched[0]?.title).toBe(
      "Interstellar",
    );
    expect((await getStats(db, user.id, "es")).mostWatched[0]?.title).toBe(
      "Interestelar",
    );
  });

  it("measures a viewing finished the day it started as zero days", async () => {
    const user = await newUser();
    await addEntry(user.id, await addMedia({ runtimeMinutes: 90 }), {
      status: "completed",
      startedAt: "2025-02-01",
      finishedAt: "2025-02-01",
    });

    const stats = await getStats(db, user.id, "es");

    expect(stats.finishTime).toEqual({ medianDays: 0, counted: 1, skipped: 0 });
  });

  it("counts the pages, chapters and volumes of a genre, and no minutes for a book or a manga (SAG-86)", async () => {
    const user = await newUser();
    await addEntry(
      user.id,
      await addMedia({
        type: "manga",
        genres: ["isekai", "fantasy"],
        externalId: { provider: "mangadex", id: "manga-1" },
      }),
      { status: "in_progress", progress: 40, progressUnit: "chapters" },
    );
    await addEntry(
      user.id,
      await addMedia({
        type: "manga",
        genres: ["isekai"],
        externalId: { provider: "mangadex", id: "manga-2" },
      }),
      { status: "completed", progress: 12, progressUnit: "volumes", score: 9 },
    );
    await addEntry(
      user.id,
      await addMedia({
        type: "book",
        genres: ["fantasy"],
        externalId: { provider: "open_library", id: "OL2W" },
      }),
      { status: "completed", progress: 300, progressUnit: "pages", score: 7 },
    );

    const stats = await getStats(db, user.id, "es");

    expect(stats.byGenre).toEqual([
      {
        genre: "fantasy",
        titles: 2,
        minutes: 0,
        pagesRead: 300,
        chaptersRead: 40,
        volumesRead: 0,
        scored: 1,
        averageScore: 7,
      },
      {
        genre: "isekai",
        titles: 2,
        minutes: 0,
        pagesRead: 0,
        chaptersRead: 40,
        volumesRead: 12,
        scored: 1,
        averageScore: 9,
      },
    ]);
  });

  it("counts the titles with no genre yet, and leaves out a key that is not on the list (SAG-86)", async () => {
    const user = await newUser();
    // Never asked (null), saved before the genres were kept.
    await addEntry(user.id, await addMedia({ runtimeMinutes: 100 }), {
      status: "completed",
    });
    const taken = await addMedia({ runtimeMinutes: 100, genres: ["drama"] });
    await db.execute(
      sql`UPDATE media_items SET genres = '["drama", "taken_out", 7]'::jsonb WHERE id = ${taken}::uuid`,
    );
    await addEntry(user.id, taken, { status: "completed" });

    const stats = await getStats(db, user.id, "es");

    expect(stats.withoutGenre).toBe(1);
    expect(stats.byGenre.map((entry) => entry.genre)).toEqual(["drama"]);
  });

  it("counts a dropped or paused title in its genres, because it was watched in part (SAG-86)", async () => {
    const user = await newUser();
    await addEntry(
      user.id,
      await addMedia({
        type: "series",
        runtimeMinutes: 30,
        episodes: 4,
        genres: ["horror"],
      }),
      { status: "dropped", progress: 2 },
    );
    await addEntry(
      user.id,
      await addMedia({ runtimeMinutes: 100, genres: ["horror"] }),
      { status: "paused" },
    );

    const stats = await getStats(db, user.id, "es");

    expect(stats.byGenre).toEqual([
      expect.objectContaining({ genre: "horror", titles: 2, minutes: 60 }),
    ]);
  });

  it("does not count a movie that is not completed as watched", async () => {
    const user = await newUser();
    await addEntry(user.id, await addMedia({ runtimeMinutes: 120 }), {
      status: "dropped",
    });

    const stats = await getStats(db, user.id, "es");

    expect(stats.minutesWatched).toBe(0);
    expect(stats.unknownRuntime).toBe(0);
  });

  it("counts a series whose episodes are not saved by the progress alone", async () => {
    const user = await newUser();
    await addEntry(
      user.id,
      await addMedia({ type: "series", runtimeMinutes: 30 }),
      { status: "in_progress", progress: 4 },
    );

    const stats = await getStats(db, user.id, "es");

    expect(stats.episodesWatched).toBe(4);
    expect(stats.minutesWatched).toBe(120);
  });
});
