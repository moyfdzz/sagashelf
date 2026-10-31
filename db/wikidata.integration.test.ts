import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveMedia } from "../server/db/media-store";
import {
  libraryEntries,
  mediaItems,
  mediaWikidata,
  wikidataItems,
  wikidataLinks,
} from "../server/db/schema";
import {
  findTitlesToLookUp,
  getRelatedFormats,
  retryAfterDays,
  saveWikidata,
} from "../server/db/wikidata-store";
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
    sql`TRUNCATE media_items, wikidata_items, wikidata_links, users RESTART IDENTITY CASCADE`,
  );
});

const base: NormalizedMedia = {
  type: "anime",
  title: "Ataque a los Titanes",
  originalTitle: null,
  year: 2013,
  synopsis: {},
  imageUrl: null,
  status: "finished",
  popularity: 1,
  externalId: { provider: "tmdb", id: "tv/1429" },
};

const mangaId = "00000000-0000-4000-8000-000000000001";

const item = (
  overrides: Partial<WikidataItem> & { qid: string },
): WikidataItem => ({
  labels: {},
  format: "other",
  ids: {},
  franchises: [],
  basedOn: [],
  ...overrides,
});

describe("findTitlesToLookUp", () => {
  it("lists the ids to look a title up by, for TMDB, Open Library and MangaDex", async () => {
    const anime = await saveMedia(db, base);
    const movie = await saveMedia(db, {
      ...base,
      type: "movie",
      externalId: { provider: "tmdb", id: "movie/603" },
    });
    const book = await saveMedia(db, {
      ...base,
      type: "book",
      externalId: { provider: "open_library", id: "OL893414W" },
    });
    const manga = await saveMedia(db, {
      ...base,
      type: "manga",
      externalId: { provider: "mangadex", id: mangaId },
      crossIds: { mal: "2", anilist: "30002" },
    });

    const found = await findTitlesToLookUp(db, 10);
    const sourcesOf = (id: string) =>
      found.find((row) => row.mediaId === id)?.sources;

    expect(sourcesOf(anime)).toEqual([{ scheme: "tmdb_tv", value: "1429" }]);
    expect(sourcesOf(movie)).toEqual([{ scheme: "tmdb_movie", value: "603" }]);
    expect(sourcesOf(book)).toEqual([
      { scheme: "open_library", value: "OL893414W" },
    ]);
    expect(sourcesOf(manga)).toEqual([
      { scheme: "mal_manga", value: "2" },
      { scheme: "anilist_manga", value: "30002" },
    ]);
  });

  it("waits for a manga to have its ids before looking it up", async () => {
    await saveMedia(db, {
      ...base,
      type: "manga",
      externalId: { provider: "mangadex", id: mangaId },
    });

    expect(await findTitlesToLookUp(db, 10)).toEqual([]);
  });

  it("leaves out the titles people made themselves", async () => {
    const id = await saveMedia(db, base);
    await db
      .update(mediaItems)
      .set({ type: "custom" })
      .where(eq(mediaItems.id, id));

    expect(await findTitlesToLookUp(db, 10)).toEqual([]);
  });

  it("looks a title up once, asks again about a miss after 30 days, and never about a match", async () => {
    const known = await saveMedia(db, base);
    const missed = await saveMedia(db, {
      ...base,
      externalId: { provider: "tmdb", id: "tv/2" },
    });
    await saveWikidata(db, {
      titles: [
        { mediaId: known, qid: "Q22126305" },
        { mediaId: missed, qid: null },
      ],
      items: [],
    });
    expect(await findTitlesToLookUp(db, 10)).toEqual([]);

    await db.execute(
      sql`UPDATE media_wikidata SET checked_at = now() - make_interval(days => ${retryAfterDays + 1})`,
    );
    expect(
      (await findTitlesToLookUp(db, 10)).map((row) => row.mediaId),
    ).toEqual([missed]);
  });

  it("puts the titles in somebody's library first, and respects the limit", async () => {
    const plain = await saveMedia(db, {
      ...base,
      externalId: { provider: "tmdb", id: "tv/1" },
    });
    const wanted = await saveMedia(db, {
      ...base,
      externalId: { provider: "tmdb", id: "tv/2" },
    });
    const user = await newUser();
    await db
      .insert(libraryEntries)
      .values({ userId: user.id, mediaId: wanted, status: "planned" });

    const [first] = await findTitlesToLookUp(db, 1);

    expect(first?.mediaId).toBe(wanted);
    expect(plain).not.toBe(wanted);
  });
});

describe("saveWikidata", () => {
  it("saves the items, their links and that each title was looked up", async () => {
    const anime = await saveMedia(db, base);

    await saveWikidata(db, {
      titles: [{ mediaId: anime, qid: "Q22126305" }],
      items: [
        item({
          qid: "Q22126305",
          labels: { es: "Ataque a los Titanes", en: "Attack on Titan" },
          format: "anime",
          ids: { tmdb_tv: "1429" },
          franchises: ["Q106712785"],
          basedOn: ["Q586025"],
        }),
      ],
    });

    expect(await db.select().from(wikidataItems)).toMatchObject([
      { qid: "Q22126305", format: "anime", ids: { tmdb_tv: "1429" } },
    ]);
    expect(
      (await db.select().from(wikidataLinks))
        .map((link) => `${link.fromQid}>${link.toQid}:${link.relation}`)
        .sort(),
    ).toEqual(["Q22126305>Q106712785:franchise", "Q22126305>Q586025:based_on"]);
    expect(await db.select().from(mediaWikidata)).toMatchObject([
      { mediaId: anime, qid: "Q22126305" },
    ]);
  });

  it("joins a later answer to what it holds: labels and ids are added, a known format is kept", async () => {
    await saveWikidata(db, {
      titles: [],
      items: [
        item({
          qid: "Q1",
          labels: { en: "One" },
          format: "manga",
          ids: { mal_manga: "2" },
          franchises: ["Q9"],
        }),
      ],
    });
    await saveWikidata(db, {
      titles: [],
      items: [
        item({
          qid: "Q1",
          labels: { es: "Uno" },
          format: "other",
          ids: { anilist_manga: "9" },
          franchises: ["Q9"],
        }),
      ],
    });

    const [row] = await db.select().from(wikidataItems);
    expect(row).toMatchObject({
      format: "manga",
      labels: { en: "One", es: "Uno" },
      ids: { mal_manga: "2", anilist_manga: "9" },
    });
    expect(await db.select().from(wikidataLinks)).toHaveLength(1);
  });

  it("replaces a miss by a match when a title is looked up again", async () => {
    const anime = await saveMedia(db, base);
    await saveWikidata(db, {
      titles: [{ mediaId: anime, qid: null }],
      items: [],
    });
    await saveWikidata(db, {
      titles: [{ mediaId: anime, qid: "Q22126305" }],
      items: [],
    });

    expect(await db.select().from(mediaWikidata)).toMatchObject([
      { qid: "Q22126305" },
    ]);
  });

  it("does nothing for an empty save", async () => {
    await saveWikidata(db, { titles: [], items: [] });

    expect(await db.select().from(wikidataItems)).toEqual([]);
  });

  it("drops the note about a title with the title", async () => {
    const anime = await saveMedia(db, base);
    await saveWikidata(db, {
      titles: [{ mediaId: anime, qid: "Q1" }],
      items: [],
    });

    await db.delete(mediaItems).where(eq(mediaItems.id, anime));

    expect(await db.select().from(mediaWikidata)).toEqual([]);
  });
});

describe("the tables refuse bad data", () => {
  it("an item id that is not Q and digits", async () => {
    expect(
      (
        await failsWith(
          db.execute(sql`INSERT INTO wikidata_items (qid) VALUES ('P42')`),
        )
      ).code,
    ).toBe("23514");
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO media_wikidata (media_id, qid) VALUES (uuidv7(), 'nope')`,
          ),
        )
      ).code,
    ).toBeDefined();
  });

  it("a relation that is not franchise or based_on", async () => {
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO wikidata_links (from_qid, to_qid, relation) VALUES ('Q1', 'Q2', 'follows')`,
          ),
        )
      ).constraint,
    ).toBe("wikidata_links_relation_check");
  });

  it("the same link twice, and labels that are not an object", async () => {
    await db.execute(
      sql`INSERT INTO wikidata_links (from_qid, to_qid, relation) VALUES ('Q1', 'Q2', 'franchise')`,
    );
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO wikidata_links (from_qid, to_qid, relation) VALUES ('Q1', 'Q2', 'franchise')`,
          ),
        )
      ).code,
    ).toBe("23505");
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO wikidata_items (qid, labels) VALUES ('Q5', '[]'::jsonb)`,
          ),
        )
      ).constraint,
    ).toBe("wikidata_items_labels_check");
  });
});

describe("getRelatedFormats", () => {
  /** The anime and its manga and film in the catalog, and a game that only Wikidata knows. */
  async function setUp() {
    const anime = await saveMedia(db, base);
    const film = await saveMedia(db, {
      ...base,
      type: "movie",
      title: "Attack on Titan: Roar",
      externalId: { provider: "tmdb", id: "movie/295830" },
    });
    const manga = await saveMedia(db, {
      ...base,
      type: "manga",
      title: "Shingeki",
      externalId: { provider: "mangadex", id: mangaId },
      crossIds: { mal: "23390", anilist: "53390" },
    });
    await saveWikidata(db, {
      titles: [{ mediaId: anime, qid: "Q22126305" }],
      items: [
        item({
          qid: "Q22126305",
          labels: { en: "Attack on Titan" },
          format: "anime",
          ids: { tmdb_tv: "1429" },
          franchises: ["Q106712785"],
          basedOn: ["Q586025"],
        }),
        item({
          qid: "Q586025",
          labels: { es: "Ataque a los Titanes" },
          format: "manga",
          ids: { mal_manga: "23390", anilist_manga: "53390" },
          franchises: ["Q106712785"],
        }),
        item({
          qid: "Q20313191",
          labels: { en: "Attack on Titan (film)" },
          format: "movie",
          ids: { tmdb_movie: "295830" },
          franchises: ["Q106712785"],
        }),
        item({
          qid: "Q20800425",
          labels: { en: "Humanity in Chains" },
          format: "game",
          franchises: ["Q106712785"],
        }),
        item({
          qid: "Q106712785",
          labels: { en: "Attack on Titan franchise" },
          format: "franchise",
        }),
        // Another story, which must not show up.
        item({
          qid: "Q1",
          labels: { en: "Unrelated" },
          format: "movie",
          franchises: ["Q2"],
        }),
      ],
    });
    return { anime, film, manga };
  }

  it("lists the other members of the franchise, matching the ones the catalog holds", async () => {
    const { anime, film, manga } = await setUp();

    const related = await getRelatedFormats(db, anime);

    expect(related.map((row) => row.qid).sort()).toEqual([
      "Q20313191",
      "Q20800425",
      "Q586025",
    ]);
    const byQid = new Map(related.map((row) => [row.qid, row]));
    // A film by its TMDB id, a manga by the MyAnimeList id MangaDex gave.
    expect(byQid.get("Q20313191")?.media).toMatchObject({
      id: film,
      type: "movie",
    });
    expect(byQid.get("Q586025")?.media).toMatchObject({
      id: manga,
      type: "manga",
    });
    // A game only Wikidata knows is listed by name, with no title of ours.
    expect(byQid.get("Q20800425")).toMatchObject({
      format: "game",
      labels: { en: "Humanity in Chains" },
      media: null,
    });
  });

  it("lists the works a title is based on, and the ones based on it, even outside a franchise", async () => {
    const anime = await saveMedia(db, base);
    await saveWikidata(db, {
      titles: [{ mediaId: anime, qid: "Q10" }],
      items: [
        item({
          qid: "Q10",
          format: "anime",
          labels: { en: "Anime" },
          basedOn: ["Q11"],
        }),
        item({ qid: "Q11", format: "book", labels: { en: "Novel" } }),
        item({
          qid: "Q12",
          format: "movie",
          labels: { en: "Film" },
          basedOn: ["Q10"],
        }),
      ],
    });

    expect(
      (await getRelatedFormats(db, anime)).map((row) => row.qid).sort(),
    ).toEqual(["Q11", "Q12"]);
  });

  it("matches a title by the item it was looked up as", async () => {
    const { anime, manga } = await setUp();
    await saveWikidata(db, {
      titles: [{ mediaId: manga, qid: "Q586025" }],
      items: [],
    });

    const related = await getRelatedFormats(db, anime);

    expect(related.find((row) => row.qid === "Q586025")?.media?.id).toBe(manga);
  });

  it("shows the same story from the manga's page, with the anime as a title of ours", async () => {
    const { anime, manga } = await setUp();
    await saveWikidata(db, {
      titles: [{ mediaId: manga, qid: "Q586025" }],
      items: [],
    });

    const related = await getRelatedFormats(db, manga);

    expect(related.find((row) => row.qid === "Q22126305")?.media?.id).toBe(
      anime,
    );
    expect(related.map((row) => row.qid)).not.toContain("Q586025");
  });

  it("is empty for a title Wikidata does not know or has not looked up", async () => {
    const lonely = await saveMedia(db, {
      ...base,
      externalId: { provider: "tmdb", id: "tv/77" },
    });
    expect(await getRelatedFormats(db, lonely)).toEqual([]);

    await saveWikidata(db, {
      titles: [{ mediaId: lonely, qid: null }],
      items: [],
    });
    expect(await getRelatedFormats(db, lonely)).toEqual([]);
  });
});
