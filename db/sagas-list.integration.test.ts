import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listSagas, saveSagas } from "../server/db/sagas";
import { saveWikidata } from "../server/db/wikidata-store";
import type { WikidataItem } from "../server/providers/wikidata/map";
import { normalizeQuery } from "../server/search/normalize";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE wikidata_items, wikidata_links, sagas RESTART IDENTITY CASCADE`,
  );
});

const item = (
  qid: string,
  format: WikidataItem["format"],
  detailed = true,
): WikidataItem => ({
  qid,
  labels: {},
  format,
  ids: {},
  franchises: [],
  basedOn: [],
  year: null,
  detailed,
});

const list = (search = "", locale: "es" | "en" = "es") =>
  listSagas(db, { search: normalizeQuery(search), locale });

/** Two published sagas whose names sort differently in each language, and their works. */
async function seed() {
  await saveSagas(db, [
    {
      slug: "witches",
      titles: { es: "Brujas", en: "Witches" },
      hash: "h1",
      members: ["Q1", "Q2", "Q3"],
    },
    {
      slug: "alpha-zeta",
      titles: { es: "Zeta del Ataque", en: "Alpha" },
      hash: "h2",
      members: ["Q4"],
    },
  ]);
  await saveWikidata(db, {
    titles: [],
    items: [
      item("Q1", "manga"),
      item("Q2", "anime"),
      item("Q3", "anime"),
      item("Q4", "book"),
    ],
  });
}

describe("listSagas (SAG-245)", () => {
  it("lists each published saga with its described works and their formats, by name in the language asked", async () => {
    await seed();

    const es = await list("", "es");
    const en = await list("", "en");

    expect(es).toEqual([
      {
        slug: "witches",
        title: "Witches",
        titles: { es: "Brujas", en: "Witches" },
        works: 3,
        formats: ["anime", "manga"],
      },
      {
        slug: "alpha-zeta",
        title: "Alpha",
        titles: { es: "Zeta del Ataque", en: "Alpha" },
        works: 1,
        formats: ["book"],
      },
    ]);
    // "Brujas" < "Zeta..." in Spanish; "Alpha" < "Witches" in English.
    expect(en.map((saga) => saga.slug)).toEqual(["alpha-zeta", "witches"]);
  });

  it("counts only the works Wikidata has described, like the page of the saga", async () => {
    await saveSagas(db, [
      {
        slug: "half",
        titles: { es: "Mitad", en: "Half" },
        hash: "h",
        members: ["Q1", "Q2"],
      },
    ]);
    await saveWikidata(db, {
      titles: [],
      items: [item("Q1", "movie"), item("Q2", "series", false)],
    });

    expect(await list()).toMatchObject([{ slug: "half", works: 1 }]);
  });

  it("never lists a draft, a saga with no described work, or finds a draft by its name", async () => {
    await seed();
    await db.execute(sql`
      INSERT INTO sagas (slug, title, titles, status, origin)
      VALUES ('ice-age', 'Ice Age', '{"es": "La era de hielo", "en": "Ice Age"}'::jsonb, 'draft', 'wikidata'),
             ('empty', 'Empty', '{}'::jsonb, 'published', 'admin')
    `);
    await db.execute(sql`
      INSERT INTO saga_wikidata_members (saga_id, qid, position)
      SELECT id, 'Q1', 0 FROM sagas WHERE slug = 'ice-age'
    `);

    expect((await list()).map((saga) => saga.slug).sort()).toEqual([
      "alpha-zeta",
      "witches",
    ]);
    expect(await list("ice age")).toEqual([]);
    expect(await list("era de hielo")).toEqual([]);
  });

  it("finds a saga by its name in either language, with no accents or capitals", async () => {
    await seed();

    expect((await list("BRUJAS")).map((saga) => saga.slug)).toEqual([
      "witches",
    ]);
    expect((await list("witch", "es")).map((saga) => saga.slug)).toEqual([
      "witches",
    ]);
    expect((await list("zeta del áTaque")).map((saga) => saga.slug)).toEqual([
      "alpha-zeta",
    ]);
    expect(await list("nothing like this")).toEqual([]);
  });

  it("finds a name that has accents when the search has none, and the other way round", async () => {
    await saveSagas(db, [
      {
        slug: "pokemon",
        titles: { es: "Pokémon: la película", en: "Pokémon" },
        hash: "h",
        members: ["Q1"],
      },
    ]);
    await saveWikidata(db, { titles: [], items: [item("Q1", "movie")] });

    expect((await list("pokemon")).map((saga) => saga.slug)).toEqual([
      "pokemon",
    ]);
    expect((await list("POKÉMON")).map((saga) => saga.slug)).toEqual([
      "pokemon",
    ]);
    expect((await list("la pelicula")).map((saga) => saga.slug)).toEqual([
      "pokemon",
    ]);
  });

  it("finds a saga by its English name even when the stored title is another one", async () => {
    // An administrator can edit the two names apart from the first title (ADR-026).
    await db.execute(sql`
      INSERT INTO sagas (slug, title, titles, status, origin)
      VALUES ('renamed', 'Old name', '{"es": "Nombre nuevo", "en": "Brand new name"}'::jsonb, 'published', 'admin')
    `);
    await saveWikidata(db, { titles: [], items: [item("Q1", "movie")] });
    await db.execute(sql`
      INSERT INTO saga_wikidata_members (saga_id, qid, position)
      SELECT id, 'Q1', 0 FROM sagas WHERE slug = 'renamed'
    `);

    expect((await list("brand new")).map((saga) => saga.slug)).toEqual([
      "renamed",
    ]);
    expect((await list("nombre nuevo")).map((saga) => saga.slug)).toEqual([
      "renamed",
    ]);
  });

  it("reads a percent sign or an underscore in the search as itself, not as a pattern", async () => {
    await seed();

    expect(await list("%")).toEqual([]);
    expect(await list("w_tches")).toEqual([]);
  });
});
