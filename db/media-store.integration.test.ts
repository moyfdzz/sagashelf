import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findMediaToRefresh,
  findStaleMedia,
  markRefreshAttempt,
  saveMedia,
  saveParts,
} from "../server/db/media-store";
import { mediaExternalIds, mediaItems, mediaParts } from "../server/db/schema";
import type { NormalizedMedia } from "../server/providers/types";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

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

describe("findStaleMedia", () => {
  it("lists the titles fetched too long ago, oldest first, with their source", async () => {
    const old = await saveMedia(db, titan);
    const older = await saveMedia(db, {
      ...titan,
      externalId: { provider: "tmdb", id: "tv/1" },
    });
    await saveMedia(db, {
      ...titan,
      externalId: { provider: "tmdb", id: "tv/2" },
    });
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '160 days' WHERE id = ${old}`,
    );
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '170 days' WHERE id = ${older}`,
    );

    const stale = await findStaleMedia(db);

    expect(stale).toEqual([
      { mediaId: older, provider: "tmdb", externalId: "tv/1" },
      { mediaId: old, provider: "tmdb", externalId: "tv/1429" },
    ]);
  });

  it("leaves out the titles people made themselves", async () => {
    const [custom] = await db
      .insert(mediaItems)
      .values({ type: "custom", title: "My own" })
      .returning();
    await db.execute(
      sql`UPDATE media_items SET fetched_at = now() - interval '400 days' WHERE id = ${custom.id}`,
    );

    expect(await findStaleMedia(db)).toEqual([]);
  });
});

describe("findMediaToRefresh and markRefreshAttempt", () => {
  const complete = {
    ...titan,
    synopsis: { es: "Sinopsis", en: "Synopsis" },
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

    const found = await findMediaToRefresh(db, 10);

    expect(found.map((item) => item.mediaId)).toEqual([
      older,
      stale,
      oneLanguage,
    ]);
    expect(found[0]).toEqual({
      mediaId: older,
      provider: "tmdb",
      externalId: "tv/3",
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

    expect(await findMediaToRefresh(db, 1)).toHaveLength(1);
    expect(await findMediaToRefresh(db, 10)).toHaveLength(2);
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
    expect((await findMediaToRefresh(db, 1))[0]?.mediaId).toBe(failing);

    await markRefreshAttempt(db, failing);

    expect((await findMediaToRefresh(db, 1))[0]?.mediaId).toBe(other);
    await makeAttemptOld(failing);
    expect((await findMediaToRefresh(db, 1))[0]?.mediaId).toBe(failing);
  });

  it("has nothing to do when every title is fresh and complete", async () => {
    await makeAttemptOld(await saveComplete("tv/1"));

    expect(await findMediaToRefresh(db, 10)).toEqual([]);
  });
});
