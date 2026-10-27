import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { findStaleMedia, saveMedia, saveParts } from "../server/db/media-store";
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
