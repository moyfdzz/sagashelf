import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  libraryEntries,
  mediaExternalIds,
  mediaItems,
  mediaParts,
  sagaMembers,
  sagas,
  users,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, media_items, sagas RESTART IDENTITY CASCADE`,
  );
});

const { newUser, newMedia } = factories(db);

describe("migrations", () => {
  it("build all 21 tables and the three extensions from zero", async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "activity",
      "audit_log",
      "blocks",
      "custom_entries",
      "follows",
      "library_entries",
      "library_viewings",
      "likes",
      "list_items",
      "lists",
      "media_external_ids",
      "media_items",
      "media_next_episode",
      "media_parts",
      "media_wikidata",
      "outbox",
      "processed_webhooks",
      "reports",
      "saga_members",
      "saga_wikidata_members",
      "sagas",
      "users",
      "webhook_deliveries",
      "webhook_endpoints",
      "wikidata_items",
      "wikidata_links",
    ]);

    const extensions = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('citext', 'pg_trgm', 'unaccent') order by 1`,
    );
    expect(extensions.rows.map((row) => row.extname)).toEqual([
      "citext",
      "pg_trgm",
      "unaccent",
    ]);
  });

  it("make time-ordered UUIDv7 ids", async () => {
    const first = await newUser();
    const second = await newUser();

    // The version digit is the first character of the third group.
    expect(first.id[14]).toBe("7");
    expect(second.id > first.id).toBe(true);
  });
});

describe("users", () => {
  it("reject a repeated Clerk id", async () => {
    await newUser({ clerkId: "clerk_same" });

    const error = await failsWith(newUser({ clerkId: "clerk_same" }));

    expect(error.code).toBe("23505");
  });

  it("treat usernames as case-insensitive", async () => {
    await newUser({ username: "Ana" });

    const error = await failsWith(newUser({ username: "ana" }));

    expect(error.code).toBe("23505");
    expect(error.constraint).toBe("users_username_unique");
  });

  it("reject a repeated canonical email, the one that stops many accounts per inbox", async () => {
    await newUser({ emailCanonical: "same@example.test" });

    const error = await failsWith(
      newUser({ emailCanonical: "same@example.test" }),
    );

    expect(error.code).toBe("23505");
  });

  it("keep a deleted user's username and email reserved", async () => {
    const gone = await newUser({ username: "gone_user" });
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    const error = await failsWith(newUser({ username: "gone_user" }));

    expect(error.code).toBe("23505");
  });

  it("enforce the username length, the locale and the bio length", async () => {
    expect((await failsWith(newUser({ username: "ab" }))).code).toBe("23514");
    expect((await failsWith(newUser({ username: "x".repeat(31) }))).code).toBe(
      "23514",
    );
    expect((await failsWith(newUser({ locale: "fr" }))).code).toBe("23514");
    expect((await failsWith(newUser({ bio: "x".repeat(501) }))).code).toBe(
      "23514",
    );
  });

  it("default to a Spanish, public, plain user", async () => {
    const row = await newUser();

    expect(row.locale).toBe("es");
    expect(row.privacy).toBe("public");
    expect(row.role).toBe("user");
    expect(row.deletedAt).toBeNull();
  });
});

describe("media external ids", () => {
  it("reject the same (provider, id) pair, even for a different title", async () => {
    const first = await newMedia({ title: "Dune" });
    const second = await newMedia({ title: "Dune (copy)" });
    await db
      .insert(mediaExternalIds)
      .values({ mediaId: first.id, provider: "tmdb", externalId: "438631" });

    const error = await failsWith(
      db.insert(mediaExternalIds).values({
        mediaId: second.id,
        provider: "tmdb",
        externalId: "438631",
      }),
    );

    expect(error.code).toBe("23505");
    expect(error.constraint).toBe(
      "media_external_ids_provider_external_id_unique",
    );
  });

  it("allow the same id in different providers and several ids per title", async () => {
    const dune = await newMedia({ title: "Dune" });

    await db.insert(mediaExternalIds).values([
      { mediaId: dune.id, provider: "tmdb", externalId: "1" },
      { mediaId: dune.id, provider: "tvmaze", externalId: "1" },
      { mediaId: dune.id, provider: "wikidata", externalId: "Q1" },
    ]);

    const rows = await db.select().from(mediaExternalIds);
    expect(rows).toHaveLength(3);
  });

  it("are deleted with their title and refuse a title that does not exist", async () => {
    const dune = await newMedia();
    await db.insert(mediaExternalIds).values({
      mediaId: dune.id,
      provider: "isbn",
      externalId: "9780441172719",
    });
    await db.delete(mediaItems).where(eq(mediaItems.id, dune.id));
    expect(await db.select().from(mediaExternalIds)).toHaveLength(0);

    const error = await failsWith(
      db.insert(mediaExternalIds).values({
        mediaId: "00000000-0000-7000-8000-000000000000",
        provider: "tmdb",
        externalId: "x",
      }),
    );
    expect(error.code).toBe("23503");
  });
});

describe("media search", () => {
  it("finds a title without typing its accents (full-text)", async () => {
    await newMedia({ title: "Pokémon" });
    await newMedia({ title: "Dune" });

    const found = await db.execute<{ title: string }>(
      sql`select title from media_items
          where search_vector @@ plainto_tsquery('simple', immutable_unaccent('pokemon'))`,
    );

    expect(found.rows.map((row) => row.title)).toEqual(["Pokémon"]);
  });

  it("finds the original title too", async () => {
    await newMedia({
      title: "Attack on Titan",
      originalTitle: "Shingeki no Kyojin",
    });

    const found = await db.execute<{ title: string }>(
      sql`select title from media_items
          where search_vector @@ plainto_tsquery('simple', 'kyojin')`,
    );

    expect(found.rows).toHaveLength(1);
  });

  it("finds a title despite a typo (trigram similarity)", async () => {
    await newMedia({ title: "Pokémon" });
    await newMedia({ title: "Cien años de soledad" });

    const found = await db.execute<{ title: string }>(
      sql`select title from media_items
          where immutable_unaccent(lower(title)) % immutable_unaccent(lower('pokemn'))`,
    );

    expect(found.rows.map((row) => row.title)).toEqual(["Pokémon"]);
  });

  it("refuse a year that makes no sense", async () => {
    expect((await failsWith(newMedia({ year: 99 }))).code).toBe("23514");
    expect((await failsWith(newMedia({ year: 3000 }))).code).toBe("23514");
  });
});

describe("media parts", () => {
  it("reject two seasons with the same number (a missing parent counts as equal)", async () => {
    const show = await newMedia({ type: "series" });
    await db
      .insert(mediaParts)
      .values({ mediaId: show.id, kind: "season", number: 1 });

    const error = await failsWith(
      db
        .insert(mediaParts)
        .values({ mediaId: show.id, kind: "season", number: 1 }),
    );

    expect(error.code).toBe("23505");
  });

  it("allow the same number for another kind, and episode 1 in every season", async () => {
    const show = await newMedia({ type: "series" });
    const [one, two] = await db
      .insert(mediaParts)
      .values([
        { mediaId: show.id, kind: "season", number: 1 },
        { mediaId: show.id, kind: "season", number: 2 },
      ])
      .returning();

    await db.insert(mediaParts).values([
      { mediaId: show.id, kind: "episode", parentId: one.id, number: 1 },
      { mediaId: show.id, kind: "episode", parentId: two.id, number: 1 },
      { mediaId: show.id, kind: "chapter", number: 1 },
    ]);

    expect(await db.select().from(mediaParts)).toHaveLength(5);
  });

  it("delete a season's episodes with it", async () => {
    const show = await newMedia({ type: "series" });
    const [season] = await db
      .insert(mediaParts)
      .values({ mediaId: show.id, kind: "season", number: 1 })
      .returning();
    await db.insert(mediaParts).values({
      mediaId: show.id,
      kind: "episode",
      parentId: season.id,
      number: 1,
    });

    await db.delete(mediaParts).where(eq(mediaParts.id, season.id));

    expect(await db.select().from(mediaParts)).toHaveLength(0);
  });
});

describe("sagas", () => {
  it("reject a repeated slug", async () => {
    await db.insert(sagas).values({ slug: "dune", title: "Dune" });

    const error = await failsWith(
      db.insert(sagas).values({ slug: "dune", title: "Dune again" }),
    );

    expect(error.code).toBe("23505");
  });

  it("list a title once per saga, and keep it in other sagas", async () => {
    const book = await newMedia({ type: "book", title: "Dune" });
    const [dune, other] = await db
      .insert(sagas)
      .values([
        { slug: "dune", title: "Dune" },
        { slug: "best-of-sci-fi", title: "Best of sci-fi" },
      ])
      .returning();
    await db
      .insert(sagaMembers)
      .values({ sagaId: dune.id, mediaId: book.id, role: "original" });

    const error = await failsWith(
      db.insert(sagaMembers).values({ sagaId: dune.id, mediaId: book.id }),
    );
    expect(error.code).toBe("23505");

    await db.insert(sagaMembers).values({ sagaId: other.id, mediaId: book.id });
    expect(await db.select().from(sagaMembers)).toHaveLength(2);
  });

  it("drop memberships when the saga or the title is deleted", async () => {
    const book = await newMedia({ type: "book" });
    const film = await newMedia({ type: "movie" });
    const [saga] = await db
      .insert(sagas)
      .values({ slug: "s", title: "S" })
      .returning();
    await db.insert(sagaMembers).values([
      { sagaId: saga.id, mediaId: book.id },
      { sagaId: saga.id, mediaId: film.id, position: 1 },
    ]);

    await db.delete(mediaItems).where(eq(mediaItems.id, film.id));
    expect(await db.select().from(sagaMembers)).toHaveLength(1);

    await db.delete(sagas).where(eq(sagas.id, saga.id));
    expect(await db.select().from(sagaMembers)).toHaveLength(0);
  });
});

describe("library entries", () => {
  it("reject a second entry for the same person and title", async () => {
    const ana = await newUser();
    const dune = await newMedia();
    await db
      .insert(libraryEntries)
      .values({ userId: ana.id, mediaId: dune.id });

    const error = await failsWith(
      db.insert(libraryEntries).values({ userId: ana.id, mediaId: dune.id }),
    );

    expect(error.code).toBe("23505");
  });

  it("let two people track the same title, and one person track many", async () => {
    const [ana, bruno] = [await newUser(), await newUser()];
    const [dune, pokemon] = [await newMedia(), await newMedia()];

    await db.insert(libraryEntries).values([
      { userId: ana.id, mediaId: dune.id },
      { userId: bruno.id, mediaId: dune.id },
      { userId: ana.id, mediaId: pokemon.id },
    ]);

    expect(await db.select().from(libraryEntries)).toHaveLength(3);
  });

  it("default to planned, no progress and private", async () => {
    const ana = await newUser();
    const dune = await newMedia();

    const [entry] = await db
      .insert(libraryEntries)
      .values({ userId: ana.id, mediaId: dune.id })
      .returning();

    expect(entry).toMatchObject({
      status: "planned",
      progress: 0,
      visibility: "private",
      rewatchCount: 0,
      score: null,
    });
  });

  it("enforce the ranges: score 1 to 10, no negative progress, dates in order, notes length", async () => {
    const ana = await newUser();
    const media = async () => (await newMedia()).id;
    const base = async () => ({ userId: ana.id, mediaId: await media() });
    const insert = async (
      values: Partial<typeof libraryEntries.$inferInsert>,
    ) =>
      failsWith(
        db.insert(libraryEntries).values({ ...(await base()), ...values }),
      );

    expect((await insert({ score: 0 })).code).toBe("23514");
    expect((await insert({ score: 11 })).code).toBe("23514");
    expect((await insert({ progress: -1 })).code).toBe("23514");
    expect((await insert({ rewatchCount: -1 })).code).toBe("23514");
    expect(
      (await insert({ startedAt: "2026-05-02", finishedAt: "2026-05-01" }))
        .code,
    ).toBe("23514");
    expect((await insert({ notes: "x".repeat(2001) })).code).toBe("23514");

    // The limits themselves are allowed.
    await db.insert(libraryEntries).values({
      ...(await base()),
      score: 10,
      startedAt: "2026-05-01",
      finishedAt: "2026-05-01",
      notes: "x".repeat(2000),
    });
  });

  it("enforce the unit and the total of the progress of a book or a manga", async () => {
    const ana = await newUser();
    const base = async () => ({
      userId: ana.id,
      mediaId: (await newMedia()).id,
    });
    const insert = async (
      values: Partial<typeof libraryEntries.$inferInsert>,
    ) =>
      failsWith(
        db.insert(libraryEntries).values({ ...(await base()), ...values }),
      );

    // A unit that does not exist is refused by the check, not only by the types.
    const badUnit = await failsWith(
      db.execute(sql`
        INSERT INTO library_entries (user_id, media_id, progress_unit)
        VALUES (${ana.id}, ${(await newMedia()).id}, 'leagues')
      `),
    );
    expect(badUnit.code).toBe("23514");
    // A total needs a unit, must be above zero, and progress never passes it.
    expect((await insert({ progressTotal: 320 })).code).toBe("23514");
    expect(
      (await insert({ progressUnit: "pages", progressTotal: 0 })).code,
    ).toBe("23514");
    expect(
      (
        await insert({
          progressUnit: "pages",
          progressTotal: 320,
          progress: 321,
        })
      ).code,
    ).toBe("23514");

    // The limits themselves, and a unit with no total, are allowed.
    await db.insert(libraryEntries).values([
      {
        ...(await base()),
        progressUnit: "pages",
        progressTotal: 320,
        progress: 320,
      },
      { ...(await base()), progressUnit: "chapters", progress: 1500 },
    ]);
  });

  it("are deleted with their person, and refuse a title that does not exist", async () => {
    const ana = await newUser();
    const dune = await newMedia();
    await db
      .insert(libraryEntries)
      .values({ userId: ana.id, mediaId: dune.id });

    await db.delete(users).where(eq(users.id, ana.id));
    expect(await db.select().from(libraryEntries)).toHaveLength(0);

    const bruno = await newUser();
    const error = await failsWith(
      db.insert(libraryEntries).values({
        userId: bruno.id,
        mediaId: "00000000-0000-7000-8000-000000000000",
      }),
    );
    expect(error.code).toBe("23503");
  });
});
