import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "../server/db/schema";

// Synthetic data for local development. Nothing here is a real person: the emails use the
// reserved `.test` domain and the Clerk ids are made up.
const url =
  process.env.DATABASE_URL ?? "postgres://sagashelf@127.0.0.1:5432/sagashelf";
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  // The seed empties the tables first, so it only ever runs on this computer.
  throw new Error("The seed only runs against a local database");
}

const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool, { schema });
const {
  activity,
  customEntries,
  follows,
  libraryEntries,
  likes,
  listItems,
  lists,
  mediaExternalIds,
  mediaItems,
  mediaParts,
  outbox,
  reports,
  sagaMembers,
  sagas,
  users,
} = schema;

async function main() {
  await db.execute(
    sql`TRUNCATE users, media_items, sagas, outbox, processed_webhooks RESTART IDENTITY CASCADE`,
  );

  const [ana, bruno, carla] = await db
    .insert(users)
    .values([
      {
        clerkId: "seed_ana",
        username: "ana_demo",
        displayName: "Ana (demo)",
        emailCanonical: "ana@example.test",
        locale: "es",
      },
      {
        clerkId: "seed_bruno",
        username: "bruno_demo",
        displayName: "Bruno (demo)",
        emailCanonical: "bruno@example.test",
        locale: "en",
      },
      {
        clerkId: "seed_carla",
        username: "carla_demo",
        displayName: "Carla (demo)",
        emailCanonical: "carla@example.test",
        privacy: "private",
      },
    ])
    .returning();

  const media = await db
    .insert(mediaItems)
    .values([
      {
        type: "book",
        title: "Dune",
        year: 1965,
        status: "finished",
        popularity: 90,
        synopsis: {
          en: "A desert planet, a family and a war for spice.",
          es: "Un planeta desértico, una familia y una guerra por la especia.",
        },
      },
      {
        type: "movie",
        title: "Dune",
        year: 2021,
        status: "finished",
        popularity: 85,
      },
      {
        type: "movie",
        title: "Dune: Part Two",
        year: 2024,
        status: "finished",
        popularity: 88,
      },
      {
        type: "manga",
        title: "Attack on Titan",
        originalTitle: "Shingeki no Kyojin",
        year: 2009,
        status: "finished",
        popularity: 92,
      },
      {
        type: "anime",
        title: "Attack on Titan",
        originalTitle: "Shingeki no Kyojin",
        year: 2013,
        status: "finished",
        popularity: 95,
      },
      {
        type: "anime",
        title: "Pokémon",
        year: 1997,
        status: "ongoing",
        popularity: 80,
      },
      {
        type: "book",
        title: "Cien años de soledad",
        originalTitle: "Cien años de soledad",
        year: 1967,
        status: "finished",
        popularity: 70,
      },
      {
        type: "series",
        title: "Breaking Bad",
        year: 2008,
        status: "finished",
        popularity: 93,
      },
    ])
    .returning();
  const byTitle = (title: string, type: string) => {
    const item = media.find((i) => i.title === title && i.type === type);
    if (!item) throw new Error(`Seed title missing: ${title} (${type})`);
    return item;
  };

  const dune = byTitle("Dune", "book");
  const dune2021 = byTitle("Dune", "movie");
  const duneTwo = byTitle("Dune: Part Two", "movie");
  const aotManga = byTitle("Attack on Titan", "manga");
  const aotAnime = byTitle("Attack on Titan", "anime");
  const pokemon = byTitle("Pokémon", "anime");
  const breakingBad = byTitle("Breaking Bad", "series");

  await db.insert(mediaExternalIds).values([
    { mediaId: dune.id, provider: "isbn", externalId: "seed-isbn-0001" },
    { mediaId: dune2021.id, provider: "tmdb", externalId: "seed-tmdb-1" },
    { mediaId: duneTwo.id, provider: "tmdb", externalId: "seed-tmdb-2" },
    { mediaId: aotAnime.id, provider: "tmdb", externalId: "seed-tmdb-3" },
    { mediaId: aotAnime.id, provider: "wikidata", externalId: "seed-Q1" },
    {
      mediaId: breakingBad.id,
      provider: "tvmaze",
      externalId: "seed-tvmaze-1",
    },
  ]);

  const [season] = await db
    .insert(mediaParts)
    .values({ mediaId: breakingBad.id, kind: "season", number: 1 })
    .returning();
  await db.insert(mediaParts).values([
    {
      mediaId: breakingBad.id,
      kind: "episode",
      parentId: season.id,
      number: 1,
      title: "Pilot",
    },
    {
      mediaId: breakingBad.id,
      kind: "episode",
      parentId: season.id,
      number: 2,
      title: "Episode 2",
    },
    { mediaId: aotManga.id, kind: "volume", number: 1 },
    { mediaId: aotManga.id, kind: "volume", number: 2 },
  ]);

  const [duneSaga, aotSaga] = await db
    .insert(sagas)
    .values([
      { slug: "dune", title: "Dune" },
      { slug: "attack-on-titan", title: "Attack on Titan" },
    ])
    .returning();
  await db.insert(sagaMembers).values([
    { sagaId: duneSaga.id, mediaId: dune.id, role: "original", position: 0 },
    {
      sagaId: duneSaga.id,
      mediaId: dune2021.id,
      role: "adaptation",
      position: 1,
    },
    { sagaId: duneSaga.id, mediaId: duneTwo.id, role: "sequel", position: 2 },
    {
      sagaId: aotSaga.id,
      mediaId: aotManga.id,
      role: "original",
      position: 0,
    },
    {
      sagaId: aotSaga.id,
      mediaId: aotAnime.id,
      role: "adaptation",
      position: 1,
    },
  ]);

  await db.insert(libraryEntries).values([
    {
      userId: ana.id,
      mediaId: dune.id,
      status: "completed",
      progress: 1,
      score: 9,
      startedAt: "2026-01-05",
      finishedAt: "2026-02-10",
      visibility: "public",
    },
    { userId: ana.id, mediaId: pokemon.id, status: "planned" },
    {
      userId: bruno.id,
      mediaId: breakingBad.id,
      status: "in_progress",
      progress: 3,
      visibility: "public",
    },
    {
      userId: bruno.id,
      mediaId: aotAnime.id,
      status: "completed",
      score: 10,
      visibility: "friends",
    },
    {
      userId: carla.id,
      mediaId: dune2021.id,
      status: "dropped",
      notes: "Private note.",
      visibility: "private",
    },
  ]);

  // Part 2: custom entries, lists, social, moderation and the outbox.
  const [fanzine] = await db
    .insert(mediaItems)
    .values({ type: "custom", title: "Mi fanzine (demo)", year: 2025 })
    .returning();
  if (!fanzine) throw new Error("The demo custom title was not created");
  const [custom] = await db
    .insert(customEntries)
    .values({ mediaId: fanzine.id, ownerId: ana.id })
    .returning();
  if (!custom) throw new Error("The demo custom entry was not created");

  const [scifi] = await db
    .insert(lists)
    .values({ ownerId: ana.id, title: "Ciencia ficción", visibility: "public" })
    .returning();
  if (!scifi) throw new Error("The demo list was not created");
  await db.insert(listItems).values([
    { listId: scifi.id, mediaId: dune.id, position: 0 },
    {
      listId: scifi.id,
      mediaId: dune2021.id,
      position: 1,
      note: "Mejor en pantalla grande.",
    },
  ]);

  await db.insert(follows).values([
    { followerId: ana.id, followeeId: bruno.id },
    { followerId: bruno.id, followeeId: ana.id },
    { followerId: carla.id, followeeId: ana.id },
  ]);

  const [event] = await db
    .insert(activity)
    .values({
      actorId: ana.id,
      type: "completed",
      mediaId: dune.id,
      payload: { score: 9 },
      visibility: "public",
    })
    .returning();
  if (!event) throw new Error("The demo activity was not created");
  await db.insert(likes).values({ userId: bruno.id, activityId: event.id });

  await db.insert(reports).values({
    reporterId: bruno.id,
    targetType: "custom_entry",
    targetId: custom.id,
    reason: "other",
    details: "Demo report for the moderation queue.",
  });
  await db.insert(outbox).values({
    type: "library.completed",
    payload: { user: "ana_demo", title: "Dune" },
    idempotencyKey: "seed-library-completed-1",
  });

  console.log(
    `Seeded 3 users, ${media.length + 1} titles, 2 sagas, 5 library entries, a list, 3 follows, an activity with a like, a report and an outbox event.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
