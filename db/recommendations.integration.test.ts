import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveMedia } from "../server/db/media-store";
import {
  getGenreRecommendations,
  getSagaSuggestions,
} from "../server/db/recommendations";
import { libraryEntries } from "../server/db/schema";
import { createSaga, setSagaStatus } from "../server/db/sagas-admin";
import { saveSagas } from "../server/db/sagas";
import { saveWikidata } from "../server/db/wikidata-store";
import type { Genre } from "../server/providers/genres";
import type { NormalizedMedia } from "../server/providers/types";
import type { WikidataItem } from "../server/providers/wikidata/map";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, media_items, wikidata_items, wikidata_links, sagas, audit_log RESTART IDENTITY CASCADE`,
  );
});

let counter = 0;
async function addTitle(
  title: string,
  genres: Genre[] | undefined,
  overrides: Partial<NormalizedMedia> = {},
): Promise<string> {
  counter += 1;
  return saveMedia(db, {
    type: "anime",
    title,
    originalTitle: null,
    year: 2015,
    synopsis: {},
    imageUrl: null,
    status: "finished",
    popularity: 1,
    externalId: { provider: "tmdb", id: `tv/${counter}` },
    ...(genres ? { genres } : {}),
    ...overrides,
  });
}

async function hold(
  userId: string,
  mediaId: string,
  values: Partial<typeof libraryEntries.$inferInsert> = {},
) {
  await db.insert(libraryEntries).values({ userId, mediaId, ...values });
}

/** A person who rated a title of each of the given genres, so those genres are liked. */
async function fanOf(genres: Genre[], score = 10) {
  const user = await newUser();
  for (const genre of genres) {
    await hold(user.id, await addTitle(`Seen ${genre}`, [genre]), {
      status: "completed",
      score,
    });
  }
  return user;
}

const titlesOf = (result: { items: { title: string }[] }) =>
  result.items.map((item) => item.title);

describe("getGenreRecommendations (SAG-87)", () => {
  it("offers the titles of the catalog in the genres the person liked, and says why", async () => {
    const user = await fanOf(["action"]);
    await addTitle("An action", ["action"]);
    await addTitle("A comedy", ["comedy"]);

    const result = await getGenreRecommendations(db, user.id, "es");

    expect(result.likedGenres).toBe(1);
    expect(result.items).toMatchObject([
      { title: "An action", type: "anime", year: 2015, because: ["action"] },
    ]);
  });

  it("never offers what the person already has, whatever its status", async () => {
    const user = await fanOf(["action"]);
    for (const status of [
      "planned",
      "in_progress",
      "completed",
      "paused",
      "dropped",
    ] as const) {
      await hold(user.id, await addTitle(`Had ${status}`, ["action"]), {
        status,
      });
    }
    await addTitle("New one", ["action"]);

    expect(titlesOf(await getGenreRecommendations(db, user.id, "es"))).toEqual([
      "New one",
    ]);
  });

  it("says nothing of what the person only planned: it does not make a genre liked", async () => {
    const user = await newUser();
    await hold(user.id, await addTitle("Planned action", ["action"]));
    await addTitle("An action", ["action"]);

    expect(await getGenreRecommendations(db, user.id, "es")).toEqual({
      likedGenres: 0,
      items: [],
    });
  });

  it("is empty for a person with nothing, and for a catalog with nothing new", async () => {
    const lonely = await newUser();
    expect(await getGenreRecommendations(db, lonely.id, "es")).toEqual({
      likedGenres: 0,
      items: [],
    });

    const fan = await fanOf(["drama"]);
    expect(await getGenreRecommendations(db, fan.id, "es")).toEqual({
      likedGenres: 1,
      items: [],
    });
  });

  it("weighs a genre by the scores: a high score likes it and a low one does not", async () => {
    const user = await newUser();
    await hold(user.id, await addTitle("Loved", ["action"]), {
      status: "completed",
      score: 9,
    });
    await hold(user.id, await addTitle("Hated", ["comedy"]), {
      status: "completed",
      score: 3,
    });
    await addTitle("An action", ["action"]);
    await addTitle("A comedy", ["comedy"]);

    const result = await getGenreRecommendations(db, user.id, "es");

    expect(result.likedGenres).toBe(1);
    expect(titlesOf(result)).toEqual(["An action"]);
  });

  it("weighs a title with no score by its status: completed likes, dropped does not", async () => {
    const user = await newUser();
    await hold(user.id, await addTitle("Finished", ["drama"]), {
      status: "completed",
    });
    await hold(user.id, await addTitle("Watching", ["mystery"]), {
      status: "in_progress",
    });
    await hold(user.id, await addTitle("Left", ["comedy"]), {
      status: "dropped",
    });
    await addTitle("A drama", ["drama"]);
    await addTitle("A mystery", ["mystery"]);
    await addTitle("A comedy", ["comedy"]);

    const result = await getGenreRecommendations(db, user.id, "es");

    // Completed (+0.5) beats in progress (+0.2); dropped (-0.3) is not liked at all.
    expect(titlesOf(result)).toEqual(["A drama", "A mystery"]);
    expect(result.likedGenres).toBe(2);
  });

  it("adds up what the person did with each genre, so a dislike takes from a like", async () => {
    const user = await newUser();
    await hold(user.id, await addTitle("Good one", ["action"]), {
      status: "completed",
      score: 8,
    });
    await hold(user.id, await addTitle("Bad one", ["action"]), {
      status: "completed",
      score: 2,
    });
    await addTitle("An action", ["action"]);

    // +0.6 and -0.6 cancel out.
    expect(await getGenreRecommendations(db, user.id, "es")).toEqual({
      likedGenres: 0,
      items: [],
    });
  });

  it("puts first the title that has more of the liked genres, and the genres the person likes most first", async () => {
    const user = await newUser();
    await hold(user.id, await addTitle("Loved action", ["action"]), {
      status: "completed",
      score: 10,
    });
    await hold(user.id, await addTitle("Liked drama", ["drama"]), {
      status: "completed",
      score: 8,
    });
    await addTitle("Only drama", ["drama"]);
    await addTitle("Both", ["drama", "action"]);

    const result = await getGenreRecommendations(db, user.id, "es");

    expect(titlesOf(result)).toEqual(["Both", "Only drama"]);
    expect(result.items[0]?.because).toEqual(["action", "drama"]);
  });

  it("does not let a title win only for having many genres", async () => {
    const user = await fanOf(["action"]);
    await addTitle("Crowded", [
      "action",
      "comedy",
      "romance",
      "mystery",
      "horror",
    ]);
    await addTitle("Focused", ["action"]);

    expect(titlesOf(await getGenreRecommendations(db, user.id, "es"))).toEqual([
      "Focused",
      "Crowded",
    ]);
  });

  it("breaks a tie with the more popular title, and respects the limit", async () => {
    const user = await fanOf(["action"]);
    await addTitle("Quiet", ["action"], { popularity: 5 });
    await addTitle("Famous", ["action"], { popularity: 900 });
    await addTitle("Middle", ["action"], { popularity: 50 });

    const all = await getGenreRecommendations(db, user.id, "es");
    const one = await getGenreRecommendations(db, user.id, "es", 1);

    expect(titlesOf(all)).toEqual(["Famous", "Middle", "Quiet"]);
    expect(titlesOf(one)).toEqual(["Famous"]);
    expect(one.likedGenres).toBe(1);
  });

  it("leaves out a title with no genres or with the genres not asked yet, and what people made themselves", async () => {
    const user = await fanOf(["action"]);
    await addTitle("Not asked", undefined);
    await addTitle("None fits", []);
    await addTitle("Mine", ["action"], { type: "anime" });
    await db.execute(
      sql`UPDATE media_items SET type = 'custom' WHERE title = 'Mine'`,
    );

    expect(await getGenreRecommendations(db, user.id, "es")).toEqual({
      likedGenres: 1,
      items: [],
    });
  });

  it("gives the title in the language of the visitor", async () => {
    const user = await fanOf(["action"]);
    const id = await addTitle("Ataque", ["action"]);
    await saveMedia(
      db,
      {
        type: "anime",
        title: "Attack",
        originalTitle: null,
        year: 2015,
        synopsis: {},
        imageUrl: null,
        status: "finished",
        popularity: 1,
        genres: ["action"],
        externalId: { provider: "tmdb", id: `tv/${counter}` },
      },
      "en",
    );

    expect(titlesOf(await getGenreRecommendations(db, user.id, "en"))).toEqual([
      "Attack",
    ]);
    expect(titlesOf(await getGenreRecommendations(db, user.id, "es"))).toEqual([
      "Ataque",
    ]);
    expect(id).toBeTruthy();
  });

  it("never uses the library of another person: not for the taste, and not to hide a title", async () => {
    const user = await fanOf(["action"]);
    const other = await fanOf(["comedy"]);
    const shared = await addTitle("Shared", ["action"]);
    await hold(other.id, shared, { status: "completed", score: 10 });
    await addTitle("Comedy only", ["comedy"]);

    const result = await getGenreRecommendations(db, user.id, "es");

    // The comedy fan's taste says nothing to this person, and what that person has does not hide
    // the title from this one.
    expect(titlesOf(result)).toEqual(["Shared"]);
    expect(result.likedGenres).toBe(1);
    expect(JSON.stringify(result)).not.toContain(other.id);
  });
});

describe("getSagaSuggestions (SAG-87)", () => {
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

  /**
   * A saga of three works in story order: a manga and an anime, which the catalog holds, and a movie
   * that only Wikidata knows.
   */
  async function titanSaga() {
    await saveSagas(db, [
      {
        slug: "attack-on-titan",
        titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
        hash: "h1",
        members: ["Q1", "Q2", "Q3"],
      },
    ]);
    await saveWikidata(db, {
      titles: [],
      items: [
        item({
          qid: "Q1",
          labels: { en: "The manga" },
          format: "manga",
          year: 2009,
          ids: { mal_manga: "23390" },
        }),
        item({
          qid: "Q2",
          labels: { en: "The anime" },
          format: "anime",
          year: 2013,
          ids: { tmdb_tv: "1429" },
        }),
        item({
          qid: "Q3",
          labels: { en: "The movie" },
          format: "movie",
          year: 2015,
        }),
      ],
    });
    const anime = await saveMedia(db, {
      type: "anime",
      title: "The anime",
      originalTitle: null,
      year: 2013,
      synopsis: {},
      imageUrl: null,
      status: "finished",
      popularity: 1,
      externalId: { provider: "tmdb", id: "tv/1429" },
    });
    const manga = await saveMedia(db, {
      type: "manga",
      title: "The manga",
      originalTitle: null,
      year: 2009,
      synopsis: {},
      imageUrl: null,
      status: "finished",
      popularity: 1,
      externalId: {
        provider: "mangadex",
        id: "00000000-0000-4000-8000-000000000001",
      },
      crossIds: { mal: "23390" },
    });
    return { anime, manga };
  }

  it("lists the works of a saga the person started that they do not have, in the order of the story", async () => {
    const user = await newUser();
    const { anime } = await titanSaga();
    await hold(user.id, anime, { status: "in_progress" });

    const suggestions = await getSagaSuggestions(db, user.id);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      slug: "attack-on-titan",
      titles: { en: "Attack on Titan" },
    });
    expect(suggestions[0]?.missing.map((work) => work.qid)).toEqual([
      "Q1",
      "Q3",
    ]);
    // The manga is held by the catalog, so it can be opened; the movie is only a name.
    expect(suggestions[0]?.missing[0]?.media).toMatchObject({ type: "manga" });
    expect(suggestions[0]?.missing[1]).toMatchObject({
      format: "movie",
      labels: { en: "The movie" },
      media: null,
    });
  });

  it("says nothing of a saga the person has not started, and nothing when they have every work", async () => {
    const user = await newUser();
    const { anime, manga } = await titanSaga();
    expect(await getSagaSuggestions(db, user.id)).toEqual([]);

    await hold(user.id, anime);
    await hold(user.id, manga);
    const [only] = await getSagaSuggestions(db, user.id);
    // Only the movie is left, and it is a name no library can hold.
    expect(only?.missing.map((work) => work.qid)).toEqual(["Q3"]);
  });

  it("counts any status as started, a planned title included", async () => {
    const user = await newUser();
    const { manga } = await titanSaga();
    await hold(user.id, manga, { status: "planned" });

    expect(await getSagaSuggestions(db, user.id)).toHaveLength(1);
  });

  it("never reads a draft", async () => {
    const user = await newUser();
    const admin = await newUser();
    const { anime } = await titanSaga();
    await hold(user.id, anime);
    const [row] = await db
      .execute(sql`SELECT id FROM sagas`)
      .then((r) => r.rows);
    await setSagaStatus(db, String(row?.id), "draft", admin.id);

    expect(await getSagaSuggestions(db, user.id)).toEqual([]);
  });

  it("leaves out the works Wikidata has not described yet", async () => {
    const user = await newUser();
    const { anime } = await titanSaga();
    await hold(user.id, anime);
    await db.execute(
      sql`UPDATE wikidata_items SET details_at = NULL WHERE qid = 'Q3'`,
    );

    const [only] = await getSagaSuggestions(db, user.id);

    expect(only?.missing.map((work) => work.qid)).toEqual(["Q1"]);
  });

  it("never lets the library of another person start a saga, or hide a work", async () => {
    const user = await newUser();
    const other = await newUser();
    const { anime, manga } = await titanSaga();
    await hold(other.id, anime);
    await hold(other.id, manga);

    expect(await getSagaSuggestions(db, user.id)).toEqual([]);

    await hold(user.id, anime);
    const [only] = await getSagaSuggestions(db, user.id);
    // The other person has the manga; this one still lacks it.
    expect(only?.missing.map((work) => work.qid)).toEqual(["Q1", "Q3"]);
  });

  it("lists each saga on its own, ordered by address", async () => {
    const user = await newUser();
    const { anime } = await titanSaga();
    const admin = await newUser();
    await hold(user.id, anime);
    const id = await createSaga(db, {
      slug: "aaa-first",
      titles: { es: "A", en: "A" },
      actorId: admin.id,
    });
    if (!id) throw new Error("The saga was not created");
    await setSagaStatus(db, id, "published", admin.id);
    await db.execute(
      sql`INSERT INTO saga_wikidata_members (saga_id, qid, position) VALUES (${id}::uuid, 'Q2', 0), (${id}::uuid, 'Q3', 1)`,
    );

    const suggestions = await getSagaSuggestions(db, user.id);

    expect(suggestions.map((saga) => saga.slug)).toEqual([
      "aaa-first",
      "attack-on-titan",
    ]);
    expect(suggestions[0]?.missing.map((work) => work.qid)).toEqual(["Q3"]);
  });
});
