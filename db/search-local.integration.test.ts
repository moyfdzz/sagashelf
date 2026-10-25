import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveMedia } from "../server/db/media-store";
import { searchLocal } from "../server/db/search-local";
import { mediaItems } from "../server/db/schema";
import type { NormalizedMedia } from "../server/providers/types";
import { normalizeQuery } from "../server/search/normalize";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE media_items RESTART IDENTITY CASCADE`);
});

let counter = 0;
async function add(
  title: string,
  overrides: Partial<NormalizedMedia> = {},
): Promise<string> {
  counter += 1;
  return saveMedia(db, {
    type: "movie",
    title,
    originalTitle: null,
    year: 2000,
    synopsis: {},
    imageUrl: null,
    status: "unknown",
    popularity: 1,
    externalId: { provider: "tmdb", id: `movie/${counter}` },
    ...overrides,
  });
}

const find = (
  query: string,
  type?: "anime" | "movie" | "series",
  limit?: number,
) => searchLocal(db, normalizeQuery(query), type, limit);

describe("searchLocal", () => {
  it("finds a title by its words, without regard to case or accents", async () => {
    await add("Pokémon: La película");

    expect((await find("POKEMON pelicula")).map((hit) => hit.title)).toEqual([
      "Pokémon: La película",
    ]);
  });

  it("finds a title from the start of its last word", async () => {
    await add("One Piece");

    expect((await find("one pie")).map((hit) => hit.title)).toEqual([
      "One Piece",
    ]);
  });

  it("finds a title with a typo", async () => {
    await add("Pokémon");

    expect((await find("pokemn")).map((hit) => hit.title)).toEqual(["Pokémon"]);
  });

  it("finds a title by its original title", async () => {
    await add("Ataque a los Titanes", {
      type: "anime",
      originalTitle: "Shingeki no Kyojin",
    });

    const hits = await find("shingeki no kyojin");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ type: "anime", exact: true });
  });

  it("puts an exact title before a close one, then the most popular", async () => {
    await add("Dune Part Two", { popularity: 99 });
    await add("Dune", { popularity: 1 });
    await add("Dunes of Mars", { popularity: 50 });

    const hits = await find("dune");

    expect(hits[0]).toMatchObject({ title: "Dune", exact: true });
    expect(hits.map((hit) => hit.title)).toContain("Dune Part Two");
    expect(hits.slice(1).every((hit) => !hit.exact)).toBe(true);
  });

  it("filters by type", async () => {
    await add("Death Note", { type: "anime" });
    await add("Death Note", { type: "movie", year: 2006 });

    const anime = await find("death note", "anime");
    const movies = await find("death note", "movie");

    expect(anime.map((hit) => hit.type)).toEqual(["anime"]);
    expect(movies.map((hit) => hit.type)).toEqual(["movie"]);
    expect(await find("death note")).toHaveLength(2);
  });

  it("returns where the title comes from, to link it later", async () => {
    const id = await add("Matrix", {
      externalId: { provider: "tmdb", id: "movie/603" },
    });

    const [hit] = await find("matrix");

    expect(hit).toMatchObject({
      id,
      provider: "tmdb",
      externalId: "movie/603",
    });
  });

  it("never returns the titles people made themselves", async () => {
    await db
      .insert(mediaItems)
      .values({ type: "custom", title: "Matrix privado" });

    expect(await find("matrix")).toEqual([]);
  });

  it("finds nothing for text that matches nothing, or has no letters", async () => {
    await add("Dune");

    expect(await find("zzzzqqqq")).toEqual([]);
    expect(await find("!!! ???")).toEqual([]);
  });

  it("treats search operators as plain text", async () => {
    await add("Dune");

    await expect(find("dune | ( & ! :*")).resolves.toBeDefined();
    await expect(find("'; drop table media_items; --")).resolves.toEqual([]);
    expect((await find("dune")).length).toBe(1);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i += 1) await add(`Dune ${i}`);

    expect(await find("dune", undefined, 3)).toHaveLength(3);
  });
});
