import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findMediaToRefresh,
  markRefreshAttempt,
  removeProviderData,
  refreshAfterDays,
  saveMedia,
  saveParts,
} from "../server/db/media-store";
import {
  libraryEntries,
  mediaExternalIds,
  mediaItems,
  mediaParts,
} from "../server/db/schema";
import { pickTitle } from "../server/db/titles";
import type { NormalizedMedia } from "../server/providers/types";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE media_items RESTART IDENTITY CASCADE`);
});

const titan: NormalizedMedia = {
  type: "anime",
  title: "Ataque a los Titanes",
  originalTitle: "進撃の巨人",
  year: 2013,
  synopsis: { es: "La humanidad vive tras enormes muros." },
  imageUrl: "https://image.tmdb.org/t/p/w500/aot.jpg",
  status: "finished",
  popularity: 250,
  externalId: { provider: "tmdb", id: "tv/1429" },
};

describe("saveMedia", () => {
  it("creates the title and records its external id", async () => {
    const id = await saveMedia(db, titan);

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item).toMatchObject({
      type: "anime",
      title: "Ataque a los Titanes",
      originalTitle: "進撃の巨人",
      year: 2013,
      status: "finished",
      synopsis: { es: "La humanidad vive tras enormes muros." },
    });
    const ids = await db.select().from(mediaExternalIds);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({
      mediaId: id,
      provider: "tmdb",
      externalId: "tv/1429",
    });
  });

  it("finds the same title again by its external id and refreshes it", async () => {
    const first = await saveMedia(db, titan);
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '100 days' WHERE id = ${first}`,
    );

    const second = await saveMedia(db, {
      ...titan,
      popularity: 999,
      year: 2014,
    });

    expect(second).toBe(first);
    const items = await db.select().from(mediaItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ popularity: 999, year: 2014 });
    // The date of the last fetch moved to now.
    expect(Date.now() - items[0].fetchedAt.getTime()).toBeLessThan(60_000);
  });

  it("keeps the synopsis of the other language when it adds a new one", async () => {
    const id = await saveMedia(db, titan);

    await saveMedia(
      db,
      {
        ...titan,
        title: "Attack on Titan",
        synopsis: { en: "Humanity lives behind walls." },
      },
      "en",
    );

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.synopsis).toEqual({
      es: "La humanidad vive tras enormes muros.",
      en: "Humanity lives behind walls.",
    });
  });

  it("keeps the title of each language, and the last one saved in `title`", async () => {
    const id = await saveMedia(db, titan, "es");
    await saveMedia(db, { ...titan, title: "Attack on Titan" }, "en");

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.titles).toEqual({
      es: "Ataque a los Titanes",
      en: "Attack on Titan",
    });
    expect(item.title).toBe("Attack on Titan");
  });

  it("saves the titles a source also knows in another language, with the one asked for winning", async () => {
    const book = {
      ...titan,
      type: "book" as const,
      title: "El jardín de las mariposas",
      titles: { en: "The Butterfly Garden", es: "Not this one" },
    };
    const id = await saveMedia(db, book, "es");

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.titles).toEqual({
      es: "El jardín de las mariposas",
      en: "The Butterfly Garden",
    });
    expect(item.title).toBe("El jardín de las mariposas");
    // Each visitor reads the title of their language, though the book was saved in Spanish.
    expect(pickTitle(item, "en")).toBe("The Butterfly Garden");
    expect(pickTitle(item, "es")).toBe("El jardín de las mariposas");
  });

  it("never erases a title in another language when a later save brings none", async () => {
    const book = {
      ...titan,
      title: "El jardín de las mariposas",
      titles: { en: "The Butterfly Garden" },
    };
    const id = await saveMedia(db, book, "es");

    // A save in Spanish without the extra titles, like a source that did not send them this time.
    await saveMedia(db, { ...book, titles: undefined }, "es");

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.titles).toEqual({
      es: "El jardín de las mariposas",
      en: "The Butterfly Garden",
    });
  });

  it("has a one-time statement that gives the books saved before an English title", async () => {
    const saved = await saveMedia(
      db,
      {
        ...titan,
        type: "book",
        title: "El jardín de las mariposas",
        originalTitle: "The Butterfly Garden",
        externalId: { provider: "open_library", id: "OL20036652W" },
      },
      "es",
    );
    const withEnglish = await saveMedia(
      db,
      {
        ...titan,
        type: "book",
        title: "Dune",
        originalTitle: "Dune Messiah",
        titles: { en: "Dune kept" },
        externalId: { provider: "open_library", id: "OL893414W" },
      },
      "es",
    );
    const series = await saveMedia(db, titan, "es");

    // The same text that SAG-78 gives the owner to run once in the Neon SQL Editor.
    await db.execute(sql`
      UPDATE media_items
      SET titles = titles || jsonb_build_object('en', original_title)
      WHERE type = 'book' AND original_title IS NOT NULL AND coalesce(titles->>'en', '') = ''
    `);

    const titlesOf = async (id: string) =>
      (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]
        ?.titles;
    expect(await titlesOf(saved)).toEqual({
      es: "El jardín de las mariposas",
      en: "The Butterfly Garden",
    });
    // An English title we hold is kept, and a series (original title in another script) is not touched.
    expect(await titlesOf(withEnglish)).toEqual({
      es: "Dune",
      en: "Dune kept",
    });
    expect(await titlesOf(series)).toEqual({ es: "Ataque a los Titanes" });
  });

  it("stores an empty synopsis for a language the source has no text in, once", async () => {
    const id = await saveMedia(db, { ...titan, synopsis: {} }, "en");

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.synopsis).toEqual({ en: "" });
  });

  it("never replaces a synopsis we hold with the empty one of a later answer", async () => {
    const id = await saveMedia(db, titan, "es");

    await saveMedia(db, { ...titan, synopsis: {} }, "es");

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.synopsis).toEqual({
      es: "La humanidad vive tras enormes muros.",
    });
  });

  it("starts a row saved before titles were kept per language with no titles", async () => {
    const id = await saveMedia(db, titan, "es");
    await db.execute(
      sql`UPDATE media_items SET titles = '{}' WHERE id = ${id}`,
    );

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.titles).toEqual({});
  });

  it("keeps the original title when a save in another language has none", async () => {
    const id = await saveMedia(
      db,
      { ...titan, title: "The Shining", originalTitle: "The Shining" },
      "en",
    );
    await saveMedia(
      db,
      { ...titan, title: "El resplandor", originalTitle: "The Shining" },
      "es",
    );
    // In English the source says the original title is the title itself, so it sends none.
    await saveMedia(
      db,
      { ...titan, title: "The Shining", originalTitle: null },
      "en",
    );

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item.originalTitle).toBe("The Shining");
  });

  it("makes one row when the same new title arrives many times together", async () => {
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => saveMedia(db, titan)),
    );

    expect(new Set(ids).size).toBe(1);
    expect(await db.select().from(mediaItems)).toHaveLength(1);
    expect(await db.select().from(mediaExternalIds)).toHaveLength(1);
  });

  it("keeps a movie and a series with the same number apart", async () => {
    const movie = await saveMedia(db, {
      ...titan,
      type: "movie",
      externalId: { provider: "tmdb", id: "movie/1429" },
    });
    const series = await saveMedia(db, titan);

    expect(movie).not.toBe(series);
    expect(await db.select().from(mediaItems)).toHaveLength(2);
  });

  it("stores a title with no year, image or synopsis", async () => {
    const id = await saveMedia(db, {
      ...titan,
      originalTitle: null,
      year: null,
      imageUrl: null,
      synopsis: {},
      externalId: { provider: "tmdb", id: "movie/5" },
    });

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item).toMatchObject({
      originalTitle: null,
      year: null,
      imageUrl: null,
      synopsis: {},
    });
  });

  it("keeps the year, the poster and the status when a refresh sends none of them (SAG-54)", async () => {
    const id = await saveMedia(db, titan);

    await saveMedia(db, {
      ...titan,
      year: null,
      imageUrl: null,
      status: "unknown",
    });

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item).toMatchObject({
      year: 2013,
      imageUrl: "https://image.tmdb.org/t/p/w500/aot.jpg",
      status: "finished",
    });
  });

  it("stores the authors, keeps them when a refresh sends none and replaces them when it sends others (SAG-14)", async () => {
    const book: NormalizedMedia = {
      ...titan,
      type: "book",
      title: "Dune",
      creators: ["Frank Herbert"],
      externalId: { provider: "open_library", id: "OL893414W" },
    };
    const id = await saveMedia(db, book);
    const read = async () =>
      (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]
        ?.creators;
    expect(await read()).toEqual(["Frank Herbert"]);

    await saveMedia(db, { ...book, creators: undefined });
    expect(await read()).toEqual(["Frank Herbert"]);
    await saveMedia(db, { ...book, creators: [] });
    expect(await read()).toEqual(["Frank Herbert"]);

    await saveMedia(db, {
      ...book,
      creators: ["Frank Herbert", "Brian Herbert"],
    });
    expect(await read()).toEqual(["Frank Herbert", "Brian Herbert"]);
  });

  it("stores no authors for a title whose source lists none", async () => {
    const id = await saveMedia(db, titan);

    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id));
    expect(item?.creators).toBeNull();
  });

  it("keeps the length of a title, and says 0 when TMDB was asked and does not know it (SAG-61)", async () => {
    const withLength = await saveMedia(db, { ...titan, runtimeMinutes: 24 });
    const without = await saveMedia(db, {
      ...titan,
      externalId: { provider: "tmdb", id: "tv/2" },
    });
    const elsewhere = await saveMedia(db, {
      ...titan,
      type: "book",
      externalId: { provider: "open_library", id: "OL1W" },
    });

    const lengths = async () =>
      Object.fromEntries(
        (await db.select().from(mediaItems)).map((item) => [
          item.id,
          item.runtimeMinutes,
        ]),
      );
    expect(await lengths()).toEqual({
      [withLength]: 24,
      [without]: 0,
      [elsewhere]: null,
    });
  });

  it("keeps the length it holds when a refresh sends none, and replaces it when it sends another (SAG-61)", async () => {
    const id = await saveMedia(db, { ...titan, runtimeMinutes: 24 });
    const length = async () =>
      (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]
        ?.runtimeMinutes;

    await saveMedia(db, titan);
    expect(await length()).toBe(24);

    await saveMedia(db, { ...titan, runtimeMinutes: 30 });
    expect(await length()).toBe(30);
  });

  describe("ids in other catalogs (SAG-16)", () => {
    const manga: NormalizedMedia = {
      ...titan,
      type: "manga",
      externalId: {
        provider: "mangadex",
        id: "00000000-0000-4000-8000-000000000001",
      },
    };
    const crossIdsOf = async (id: string) =>
      (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]
        ?.crossIds;

    it("saves the ids, leaves them null when the source did not say, and saves an empty object when it said none", async () => {
      const said = await saveMedia(db, {
        ...manga,
        crossIds: { mal: "2", anilist: "30002" },
      });
      const none = await saveMedia(db, {
        ...manga,
        externalId: {
          provider: "mangadex",
          id: "00000000-0000-4000-8000-000000000002",
        },
        crossIds: {},
      });
      const silent = await saveMedia(db, titan);

      expect(await crossIdsOf(said)).toEqual({ mal: "2", anilist: "30002" });
      expect(await crossIdsOf(none)).toEqual({});
      expect(await crossIdsOf(silent)).toBeNull();
    });

    it("keeps the ids it holds when a later save brings none, and replaces them when it brings others", async () => {
      const id = await saveMedia(db, { ...manga, crossIds: { mal: "2" } });

      await saveMedia(db, { ...manga, crossIds: {} });
      expect(await crossIdsOf(id)).toEqual({ mal: "2" });
      await saveMedia(db, { ...manga, crossIds: { mal: "3", anilist: "9" } });
      expect(await crossIdsOf(id)).toEqual({ mal: "3", anilist: "9" });
    });

    it("keeps an empty object when the title held nothing, which says it was asked", async () => {
      const id = await saveMedia(db, titan);
      await saveMedia(db, { ...titan, crossIds: {} });

      expect(await crossIdsOf(id)).toEqual({});
    });
  });

  describe("genres (SAG-71)", () => {
    const genresOf = async (id: string) =>
      (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]
        ?.genres;

    it("saves the genres, leaves them null when the source did not say, and saves an empty list when it said none", async () => {
      const said = await saveMedia(db, {
        ...titan,
        genres: ["action", "drama"],
      });
      const silent = await saveMedia(db, {
        ...titan,
        externalId: { provider: "tmdb", id: "tv/2" },
      });
      const none = await saveMedia(db, {
        ...titan,
        genres: [],
        externalId: { provider: "tmdb", id: "tv/3" },
      });

      expect(await genresOf(said)).toEqual(["action", "drama"]);
      expect(await genresOf(silent)).toBeNull();
      expect(await genresOf(none)).toEqual([]);
    });

    it("replaces the genres it holds when the source sends others", async () => {
      const id = await saveMedia(db, { ...titan, genres: ["action"] });

      await saveMedia(db, { ...titan, genres: ["drama", "mystery"] });

      expect(await genresOf(id)).toEqual(["drama", "mystery"]);
    });

    it("keeps the genres it holds when a refresh sends none or an empty list", async () => {
      const id = await saveMedia(db, { ...titan, genres: ["action"] });

      await saveMedia(db, titan);
      expect(await genresOf(id)).toEqual(["action"]);

      await saveMedia(db, { ...titan, genres: [] });
      expect(await genresOf(id)).toEqual(["action"]);
    });

    it("keeps an empty list when the title held nothing, which says it was asked", async () => {
      const id = await saveMedia(db, titan);
      expect(await genresOf(id)).toBeNull();

      await saveMedia(db, { ...titan, genres: [] });

      expect(await genresOf(id)).toEqual([]);
    });

    it("is refused by the table when the genres are not a list", async () => {
      const id = await saveMedia(db, titan);

      const failure = await failsWith(
        db.execute(
          sql`UPDATE media_items SET genres = '"action"'::jsonb WHERE id = ${id}::uuid`,
        ),
      );

      expect(failure).toEqual({
        code: "23514",
        constraint: "media_items_genres_check",
      });
    });
  });

  it("is refused by the table when the length is negative", async () => {
    await expect(
      saveMedia(db, { ...titan, runtimeMinutes: -1 }),
    ).rejects.toThrow();
    expect(await db.select().from(mediaItems)).toHaveLength(0);
  });

  it("is refused by the table when the year is out of range", async () => {
    await expect(saveMedia(db, { ...titan, year: 12 })).rejects.toThrow();
    expect(await db.select().from(mediaItems)).toHaveLength(0);
    expect(await db.select().from(mediaExternalIds)).toHaveLength(0);
  });
});

describe("saveParts", () => {
  const parts = [
    {
      kind: "season" as const,
      number: 1,
      title: "Temporada 1",
      airDate: "2013-04-07",
    },
    {
      kind: "episode" as const,
      number: 1,
      title: "Uno",
      airDate: "2013-04-07",
      seasonNumber: 1,
    },
    {
      kind: "episode" as const,
      number: 2,
      title: "Dos",
      airDate: null,
      seasonNumber: 1,
    },
    { kind: "season" as const, number: 2, title: null, airDate: null },
  ];

  it("stores seasons and episodes, each episode under its season", async () => {
    const id = await saveMedia(db, titan);

    await saveParts(db, id, parts);

    const rows = await db
      .select()
      .from(mediaParts)
      .where(eq(mediaParts.mediaId, id));
    const seasons = rows.filter((row) => row.kind === "season");
    const episodes = rows.filter((row) => row.kind === "episode");
    expect(seasons.map((row) => row.number).sort()).toEqual([1, 2]);
    expect(episodes).toHaveLength(2);
    const seasonOne = seasons.find((row) => row.number === 1);
    expect(episodes.every((row) => row.parentId === seasonOne?.id)).toBe(true);
    expect(seasonOne?.airDate).toBe("2013-04-07");
  });

  it("updates what is there instead of repeating it", async () => {
    const id = await saveMedia(db, titan);
    await saveParts(db, id, parts);

    await saveParts(db, id, [
      { ...parts[0], title: "Primera temporada" },
      parts[1],
    ]);

    const rows = await db
      .select()
      .from(mediaParts)
      .where(eq(mediaParts.mediaId, id));
    expect(rows).toHaveLength(4);
    expect(
      rows.find((row) => row.kind === "season" && row.number === 1)?.title,
    ).toBe("Primera temporada");
  });

  it("keeps the average length of the episodes as the length of the title (SAG-61)", async () => {
    const id = await saveMedia(db, { ...titan, runtimeMinutes: 99 });
    const length = async () =>
      (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]
        ?.runtimeMinutes;

    await saveParts(db, id, [
      { kind: "season", number: 1, title: null, airDate: null },
      {
        kind: "episode",
        number: 1,
        title: null,
        airDate: null,
        seasonNumber: 1,
        runtimeMinutes: 40,
      },
      {
        kind: "episode",
        number: 2,
        title: null,
        airDate: null,
        seasonNumber: 1,
        runtimeMinutes: 45,
      },
      {
        kind: "episode",
        number: 3,
        title: null,
        airDate: null,
        seasonNumber: 1,
      },
    ]);
    expect(await length()).toBe(43);

    // Episodes that say nothing leave the length alone.
    await saveParts(db, id, parts);
    expect(await length()).toBe(43);
  });

  it("does nothing for a title with no parts", async () => {
    const id = await saveMedia(db, titan);

    await saveParts(db, id, []);

    expect(await db.select().from(mediaParts)).toHaveLength(0);
  });

  it("drops with the title", async () => {
    const id = await saveMedia(db, titan);
    await saveParts(db, id, parts);

    await db.delete(mediaItems).where(eq(mediaItems.id, id));

    expect(await db.select().from(mediaParts)).toHaveLength(0);
    expect(await db.select().from(mediaExternalIds)).toHaveLength(0);
  });
});

describe("findMediaToRefresh and markRefreshAttempt", () => {
  const allProviders = ["tmdb", "mangadex", "open_library"];
  const complete = {
    ...titan,
    synopsis: { es: "Sinopsis", en: "Synopsis" },
    genres: ["drama" as const],
  };

  /** A title held in both languages, with a synopsis in each. */
  async function saveComplete(externalId: string) {
    const media = {
      ...complete,
      externalId: { provider: "tmdb" as const, id: externalId },
    };
    await saveMedia(db, media, "es");
    return saveMedia(db, media, "en");
  }

  /** Moves the last attempt back, so the title is not waiting out its retry window. */
  const makeAttemptOld = (mediaId: string) =>
    db.execute(
      sql`UPDATE media_external_ids SET updated_at = now() - interval '3 days' WHERE media_id = ${mediaId}`,
    );

  it("asks once for the titles of TMDB saved before their length was kept, and not again (SAG-61)", async () => {
    const old = await saveComplete("tv/1");
    const asked = await saveComplete("tv/2");
    await db.execute(
      sql`UPDATE media_items SET runtime_minutes = NULL WHERE id = ${old}::uuid`,
    );
    for (const id of [old, asked]) await makeAttemptOld(id);

    expect(
      (await findMediaToRefresh(db, 10, allProviders)).map(
        (row) => row.mediaId,
      ),
    ).toEqual([old]);

    // Saving it again, even when TMDB sends no length, says it was asked.
    await saveMedia(
      db,
      { ...complete, externalId: { provider: "tmdb", id: "tv/1" } },
      "es",
    );
    await makeAttemptOld(old);
    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("asks once for the titles saved before their genres were kept, whatever the source (SAG-71)", async () => {
    const old = await saveComplete("tv/1");
    const asked = await saveComplete("tv/2");
    const book = {
      ...complete,
      type: "book" as const,
      externalId: { provider: "open_library" as const, id: "OL1W" },
    };
    await saveMedia(db, book, "es");
    const oldBook = await saveMedia(db, book, "en");
    for (const id of [old, oldBook]) {
      await db.execute(
        sql`UPDATE media_items SET genres = NULL WHERE id = ${id}::uuid`,
      );
    }
    for (const id of [old, asked, oldBook]) await makeAttemptOld(id);

    expect(
      (await findMediaToRefresh(db, 10, allProviders))
        .map((row) => row.mediaId)
        .sort(),
    ).toEqual([old, oldBook].sort());

    // Saving them again with an empty list says "asked, none of ours fits".
    for (const media of [
      {
        ...complete,
        genres: [],
        externalId: { provider: "tmdb" as const, id: "tv/1" },
      },
      { ...book, genres: [] },
    ]) {
      await saveMedia(db, media, "es");
    }
    for (const id of [old, oldBook]) await makeAttemptOld(id);
    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("asks again for a title whose source sent no genres, until it says some or none (SAG-71)", async () => {
    const id = await saveComplete("tv/1");
    await db.execute(
      sql`UPDATE media_items SET genres = NULL WHERE id = ${id}::uuid`,
    );
    // The same title, as a source that says no genres.
    const silent = { ...titan, synopsis: complete.synopsis };

    await saveMedia(
      db,
      { ...silent, externalId: { provider: "tmdb", id: "tv/1" } },
      "es",
    );
    await makeAttemptOld(id);

    expect(
      (await findMediaToRefresh(db, 10, allProviders)).map(
        (row) => row.mediaId,
      ),
    ).toEqual([id]);
  });

  it("puts the titles that are in somebody's library before the ones that are not, after the stale ones (SAG-71)", async () => {
    const user = await newUser();
    const lonely = await saveComplete("tv/1");
    const kept = await saveComplete("tv/2");
    const stale = await saveComplete("tv/3");
    for (const id of [lonely, kept, stale]) {
      await db.execute(
        sql`UPDATE media_items SET genres = NULL WHERE id = ${id}::uuid`,
      );
      await makeAttemptOld(id);
    }
    // The title nobody holds is the oldest, so only the library can put the other first.
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '100 days' WHERE id = ${lonely}::uuid`,
    );
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '170 days' WHERE id = ${stale}::uuid`,
    );
    await db.insert(libraryEntries).values({ userId: user.id, mediaId: kept });

    expect(
      (await findMediaToRefresh(db, 10, allProviders)).map(
        (row) => row.mediaId,
      ),
    ).toEqual([stale, kept, lonely]);
  });

  it("asks once for the manga saved before their ids in other catalogs were kept, and not again (SAG-16)", async () => {
    const manga = {
      ...complete,
      type: "manga" as const,
      externalId: {
        provider: "mangadex" as const,
        id: "00000000-0000-4000-8000-000000000001",
      },
    };
    await saveMedia(db, manga, "es");
    const id = await saveMedia(db, manga, "en");
    const tmdb = await saveComplete("tv/1");
    await makeAttemptOld(id);
    await makeAttemptOld(tmdb);

    // The title of TMDB never has these ids, so it is not asked for them.
    expect(
      (await findMediaToRefresh(db, 10, allProviders)).map(
        (row) => row.mediaId,
      ),
    ).toEqual([id]);

    await saveMedia(db, { ...manga, crossIds: {} }, "en");
    await makeAttemptOld(id);
    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("never asks for the length of a title of another source (SAG-61)", async () => {
    const book = {
      ...complete,
      type: "book" as const,
      externalId: { provider: "open_library" as const, id: "OL1W" },
    };
    await saveMedia(db, book, "es");
    const id = await saveMedia(db, book, "en");
    await makeAttemptOld(id);

    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("lists what is stale first, oldest first, then what lacks a language", async () => {
    const fresh = await saveComplete("tv/1");
    const stale = await saveComplete("tv/2");
    const older = await saveComplete("tv/3");
    const oneLanguage = await saveMedia(
      db,
      { ...titan, externalId: { provider: "tmdb", id: "tv/4" } },
      "es",
    );
    for (const id of [fresh, stale, older, oneLanguage])
      await makeAttemptOld(id);
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '160 days' WHERE id = ${stale}`,
    );
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '170 days' WHERE id = ${older}`,
    );

    const found = await findMediaToRefresh(db, 10, allProviders);

    expect(found.map((item) => item.mediaId)).toEqual([
      older,
      stale,
      oneLanguage,
    ]);
    expect(found[0]).toEqual({
      mediaId: older,
      provider: "tmdb",
      externalId: "tv/3",
      stale: true,
    });
  });

  it("respects the limit and leaves out the titles people made themselves", async () => {
    const one = await saveComplete("tv/1");
    const two = await saveComplete("tv/2");
    for (const id of [one, two]) {
      await makeAttemptOld(id);
      await db.execute(
        sql`UPDATE media_items SET fetched_at = now() - interval '160 days' WHERE id = ${id}`,
      );
    }
    await db.insert(mediaItems).values({ type: "custom", title: "My own" });

    expect(await findMediaToRefresh(db, 1, allProviders)).toHaveLength(1);
    expect(await findMediaToRefresh(db, 10, allProviders)).toHaveLength(2);
  });

  it("takes a complete title only once it is older than the refresh age (SAG-197)", async () => {
    const young = await saveComplete("tv/1");
    const due = await saveComplete("tv/2");
    for (const id of [young, due]) await makeAttemptOld(id);
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - make_interval(days => ${refreshAfterDays - 5}) WHERE id = ${young}::uuid`,
    );
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - make_interval(days => ${refreshAfterDays + 5}) WHERE id = ${due}::uuid`,
    );

    expect(
      (await findMediaToRefresh(db, 10, allProviders)).map(
        (row) => row.mediaId,
      ),
    ).toEqual([due]);
  });

  it("never returns a title people made themselves, even with an external id (SAG-197)", async () => {
    const id = await saveComplete("tv/1");
    await makeAttemptOld(id);
    await db.execute(
      sql`UPDATE media_items SET type = 'custom', fetched_at = now() - interval '400 days' WHERE id = ${id}::uuid`,
    );

    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("leaves a title out for a day after an attempt, so a failing one does not block the rest", async () => {
    const failing = await saveComplete("tv/1");
    const other = await saveComplete("tv/2");
    for (const id of [failing, other]) {
      await makeAttemptOld(id);
      await db.execute(
        sql`UPDATE media_items SET fetched_at = now() - interval '160 days' WHERE id = ${id}`,
      );
    }
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '175 days' WHERE id = ${failing}`,
    );
    expect((await findMediaToRefresh(db, 1, allProviders))[0]?.mediaId).toBe(
      failing,
    );

    await markRefreshAttempt(db, failing);

    expect((await findMediaToRefresh(db, 1, allProviders))[0]?.mediaId).toBe(
      other,
    );
    await makeAttemptOld(failing);
    expect((await findMediaToRefresh(db, 1, allProviders))[0]?.mediaId).toBe(
      failing,
    );
  });

  it("leaves out the titles of a provider that is switched off, so they cannot fill the batch (SAG-179)", async () => {
    const manga = {
      ...complete,
      type: "manga" as const,
      crossIds: {},
    };
    const mangaIds: string[] = [];
    for (let n = 1; n <= 5; n += 1) {
      const media = {
        ...manga,
        externalId: { provider: "mangadex" as const, id: `md-${n}` },
      };
      await saveMedia(db, media, "es");
      mangaIds.push(await saveMedia(db, media, "en"));
    }
    const movie = await saveComplete("movie/1");
    for (const id of [...mangaIds, movie]) {
      await makeAttemptOld(id);
      await db.execute(
        sql`UPDATE media_items SET fetched_at = now() - interval '${sql.raw(id === movie ? "170" : "175")} days' WHERE id = ${id}`,
      );
    }

    // With MangaDex off, the only title that can be asked is the one of TMDB.
    expect(
      (await findMediaToRefresh(db, 5, ["tmdb"])).map((row) => row.mediaId),
    ).toEqual([movie]);
    expect(await findMediaToRefresh(db, 5, [])).toEqual([]);
    expect(await findMediaToRefresh(db, 5, allProviders)).toHaveLength(5);
  });

  it("has nothing to do when every title is fresh and complete", async () => {
    await makeAttemptOld(await saveComplete("tv/1"));

    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("keeps a title due when a refresh stopped before its last language (SAG-182)", async () => {
    const id = await saveComplete("movie/9");
    const media = {
      ...complete,
      externalId: { provider: "tmdb" as const, id: "movie/9" },
    };
    const oldFetch = () =>
      db.execute(
        sql`UPDATE media_items SET fetched_at = now() - interval '170 days' WHERE id = ${id}`,
      );
    await oldFetch();

    // The first language is saved without marking the row fresh, and the run stops there.
    await saveMedia(db, media, "en", false);
    await makeAttemptOld(id);
    expect(
      (await findMediaToRefresh(db, 5, allProviders)).map((row) => row.mediaId),
    ).toEqual([id]);

    // The last language marks it fresh.
    await saveMedia(db, media, "es", true);
    await makeAttemptOld(id);
    expect(await findMediaToRefresh(db, 5, allProviders)).toEqual([]);
  });
});

describe("removeProviderData (SAG-180)", () => {
  const allProviders = ["tmdb", "mangadex", "open_library"];

  it("empties what TMDB sent, keeps the row, its names and its parts, and leaves it out of the refresh until it is stale again", async () => {
    const id = await saveMedia(
      db,
      {
        ...titan,
        synopsis: { es: "Sinopsis", en: "Synopsis" },
        genres: ["drama"],
        creators: ["Alguien"],
        runtimeMinutes: 45,
        imageUrl: "https://image.tmdb.org/t/p/w500/x.jpg",
        popularity: 12,
        externalId: { provider: "tmdb", id: "tv/9" },
      },
      "es",
    );
    await saveMedia(
      db,
      {
        ...titan,
        synopsis: { es: "Sinopsis", en: "Synopsis" },
        genres: ["drama"],
        externalId: { provider: "tmdb", id: "tv/9" },
      },
      "en",
    );
    await saveParts(db, id, [
      {
        kind: "season",
        number: 1,
        title: "Temporada 1",
        airDate: "2020-01-01",
      },
    ]);
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '160 days' WHERE id = ${id}`,
    );
    await db.execute(
      sql`UPDATE media_external_ids SET updated_at = now() - interval '3 days' WHERE media_id = ${id}`,
    );
    expect((await findMediaToRefresh(db, 10, allProviders))[0]?.stale).toBe(
      true,
    );

    await removeProviderData(db, id);

    const [item] = (
      await db.execute(
        sql`SELECT title, titles, synopsis, creators, runtime_minutes, genres, image_url,
                   popularity, fetched_at > now() - interval '1 minute' AS fresh
            FROM media_items WHERE id = ${id}`,
      )
    ).rows;
    expect(item).toMatchObject({
      title: titan.title,
      synopsis: { es: "", en: "" },
      creators: null,
      runtime_minutes: 0,
      genres: [],
      image_url: null,
      popularity: 0,
      fresh: true,
    });
    expect(item?.titles).toBeTruthy();
    const parts = (
      await db.execute(
        sql`SELECT number, title, air_date FROM media_parts WHERE media_id = ${id}`,
      )
    ).rows;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ number: 1, title: null, air_date: null });
    // It does not take a place in the batch of every run, and the row is still in the catalog.
    expect(await findMediaToRefresh(db, 10, allProviders)).toEqual([]);
  });

  it("does not touch another title", async () => {
    const other = await saveMedia(
      db,
      {
        ...titan,
        synopsis: { es: "Sinopsis", en: "Synopsis" },
        externalId: { provider: "tmdb", id: "tv/10" },
      },
      "es",
    );
    const gone = await saveMedia(
      db,
      { ...titan, externalId: { provider: "tmdb", id: "tv/11" } },
      "es",
    );

    await removeProviderData(db, gone);

    const [row] = (
      await db.execute(
        sql`SELECT synopsis FROM media_items WHERE id = ${other}`,
      )
    ).rows;
    expect(row?.synopsis).toMatchObject({ es: "Sinopsis" });
  });
});
