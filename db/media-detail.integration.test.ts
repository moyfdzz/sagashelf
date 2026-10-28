import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findMediaByExternalId,
  getMediaDetail,
} from "../server/db/media-detail";
import { saveMedia, saveParts } from "../server/db/media-store";
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

describe("getMediaDetail", () => {
  it("reads the authors of a book, and an empty list for a title with none", async () => {
    const book = await saveMedia(db, {
      ...titan,
      type: "book",
      creators: ["Frank Herbert"],
      externalId: { provider: "open_library", id: "OL893414W" },
    });
    const anime = await saveMedia(db, titan);

    expect((await getMediaDetail(db, book))?.creators).toEqual([
      "Frank Herbert",
    ]);
    expect((await getMediaDetail(db, anime))?.creators).toEqual([]);
  });

  it("reads a title with its source id and its seasons and episodes in order", async () => {
    const id = await saveMedia(db, titan);
    await saveParts(db, id, [
      {
        kind: "season",
        number: 2,
        title: "Temporada 2",
        airDate: "2017-04-01",
      },
      {
        kind: "season",
        number: 1,
        title: "Temporada 1",
        airDate: "2013-04-07",
      },
      {
        kind: "episode",
        number: 2,
        title: "Ese día",
        airDate: "2013-04-14",
        seasonNumber: 1,
      },
      {
        kind: "episode",
        number: 1,
        title: "A ti, dentro de 2000 años",
        airDate: "2013-04-07",
        seasonNumber: 1,
      },
      {
        kind: "episode",
        number: 1,
        title: "Bestia Titán",
        airDate: "2017-04-01",
        seasonNumber: 2,
      },
    ]);

    const detail = await getMediaDetail(db, id);

    expect(detail).toMatchObject({
      id,
      type: "anime",
      title: "Ataque a los Titanes",
      originalTitle: "進撃の巨人",
      year: 2013,
      status: "finished",
      imageUrl: "https://image.tmdb.org/t/p/w500/aot.jpg",
      provider: "tmdb",
      externalId: "tv/1429",
      synopsis: { es: "La humanidad vive tras enormes muros." },
    });
    expect(detail?.fetchedAt).toBeInstanceOf(Date);
    expect(
      detail?.seasons.map((season) => [
        season.number,
        season.episodes.map((episode) => episode.number),
      ]),
    ).toEqual([
      [1, [1, 2]],
      [2, [1]],
    ]);
    expect(detail?.seasons[0]?.episodes[0]).toEqual({
      number: 1,
      title: "A ti, dentro de 2000 años",
      airDate: "2013-04-07",
    });
  });

  it("reads a title with no seasons", async () => {
    const id = await saveMedia(db, {
      ...titan,
      type: "movie",
      externalId: { provider: "tmdb", id: "movie/1" },
    });

    expect((await getMediaDetail(db, id))?.seasons).toEqual([]);
  });

  it("finds nothing for an id we do not hold", async () => {
    expect(
      await getMediaDetail(db, "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    ).toBeNull();
  });

  it("gives no page to a title that a person made themselves", async () => {
    const [row] = (
      await db.execute(sql`
        INSERT INTO media_items (type, title) VALUES ('custom', 'Mi historia') RETURNING id
      `)
    ).rows;
    await db.execute(sql`
      INSERT INTO media_external_ids (media_id, provider, external_id)
      VALUES (${String(row?.id)}::uuid, 'tmdb', 'movie/999')
    `);

    expect(await getMediaDetail(db, String(row?.id))).toBeNull();
    expect(await findMediaByExternalId(db, "tmdb", "movie/999")).toBeNull();
  });
});

describe("findMediaByExternalId", () => {
  it("finds a title by the id its source gave it", async () => {
    const id = await saveMedia(db, titan);

    expect(await findMediaByExternalId(db, "tmdb", "tv/1429")).toEqual({
      id,
      type: "anime",
      title: "Ataque a los Titanes",
    });
  });

  it("finds nothing for an id we do not hold", async () => {
    expect(await findMediaByExternalId(db, "tmdb", "tv/0")).toBeNull();
  });
});
