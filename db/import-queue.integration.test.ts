import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eraseAccount } from "../server/db/erase-user";
import {
  latestImportProgress,
  pruneImportJobs,
} from "../server/db/import-queue";
import { importRows, libraryEntries, users } from "../server/db/schema";
import { saveMedia } from "../server/db/media-store";
import { processImportBatch } from "../server/jobs/process-imports";
import { runImport } from "../server/library/import";
import { parseImportFile } from "../server/library/import-file";
import type { MediaProvider, NormalizedMedia } from "../server/providers/types";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

const movie = (id: number): NormalizedMedia => ({
  type: "movie",
  title: `Movie ${id}`,
  originalTitle: null,
  year: 2014,
  synopsis: {},
  imageUrl: null,
  status: "finished",
  popularity: 1,
  externalId: { provider: "tmdb", id: `movie/${id}` },
});

/** A provider that knows these ids; any other is "not found", and the ones in `down` throw. */
function provider(known: number[], down: number[] = []): MediaProvider {
  return {
    id: "tmdb",
    capabilities: { types: ["movie"], parts: false, trending: false },
    attribution: {
      name: "TMDB",
      url: "https://www.themoviedb.org",
      notice: "",
    },
    search: vi.fn(),
    getById: vi.fn(async (externalId: string) => {
      const n = Number(externalId.split("/")[1]);
      if (down.includes(n)) throw new Error("down");
      return known.includes(n) ? movie(n) : null;
    }),
    getParts: vi.fn(async () => []),
  };
}

const entry = (n: number) => ({
  title: `Movie ${n}`,
  source: { provider: "tmdb", id: `movie/${n}` },
  status: "completed",
  progress: 0,
  progressUnit: null,
  progressTotal: null,
  score: 8,
  startedAt: null,
  finishedAt: null,
  notes: null,
  viewings: [],
});

/** Uploads a file of these movies: everything the provider knows waits in the queue. */
async function upload(
  userId: string,
  numbers: number[],
  options: { replace?: boolean } = {},
) {
  const parsed = parseImportFile(
    JSON.stringify({ schemaVersion: 1, libraryEntries: numbers.map(entry) }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return runImport({ db, providers: [provider([])] }, userId, parsed.value, {
    replace: options.replace ?? false,
    locale: "es",
  });
}

const run = (tmdb: MediaProvider) =>
  processImportBatch({ db, providers: [tmdb] });

async function rows() {
  return (
    await db.execute(
      sql`SELECT j.user_id, r.title, r.state, r.reason, r.attempts, r.retry_at > now() AS waits,
                 r.retry_at = (date_trunc('day', now() AT TIME ZONE 'utc') + interval '1 day') AT TIME ZONE 'utc' AS until_midnight
          FROM import_rows r JOIN import_jobs j ON j.id = r.job_id
          ORDER BY j.created_at, r.position`,
    )
  ).rows;
}

const libraryOf = async (userId: string) =>
  (
    await db
      .select({ id: libraryEntries.mediaId })
      .from(libraryEntries)
      .where(eq(libraryEntries.userId, userId))
  ).length;

async function setBudgetUsed(userId: string, used: number) {
  await db
    .update(users)
    .set({
      titleFetchesDay: sql`(now() AT TIME ZONE 'utc')::date`,
      titleFetchesCount: used,
    })
    .where(eq(users.id, userId));
}

describe("the batch of the import queue (SAG-241)", () => {
  it("saves the waiting titles, writes them to the library and leaves no row for them", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2, 3]);

    const tmdb = provider([1, 2, 3]);
    const summary = await run(tmdb);

    expect(summary).toMatchObject({ taken: 3, added: 3, skipped: 0 });
    expect(tmdb.getById).toHaveBeenCalledTimes(3);
    expect(await libraryOf(ana.id)).toBe(3);
    expect(await rows()).toEqual([]);
    expect(await latestImportProgress(db, ana.id)).toMatchObject({
      total: 3,
      added: 3,
      pending: 0,
      skippedCount: 0,
    });
    // Written by hand: three titles from the provider used three units of the day.
    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.titleFetchesCount).toBe(3);
  });

  it("takes at most 5 titles a run", async () => {
    const ana = await newUser();
    const luis = await newUser();
    await upload(ana.id, [1, 2, 3, 4]);
    await upload(luis.id, [11, 12, 13, 14]);

    const summary = await run(provider([1, 2, 3, 4, 11, 12, 13, 14]));

    // Ana (the oldest) gives 3 and Luis gives the 2 that fit in the 5 of a run.
    expect(summary.taken).toBe(5);
    expect(await libraryOf(ana.id)).toBe(3);
    expect(await libraryOf(luis.id)).toBe(2);
  });

  it("takes at most 3 titles from one person, so one big import does not starve the others", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2, 3, 4, 5, 6]);

    expect((await run(provider([1, 2, 3, 4, 5, 6]))).taken).toBe(3);
  });

  it("takes titles from at most 2 people, the ones waiting longest", async () => {
    const ana = await newUser();
    const luis = await newUser();
    const eva = await newUser();
    await upload(ana.id, [1, 2]);
    await upload(luis.id, [11, 12]);
    await upload(eva.id, [21, 22]);

    const summary = await run(provider([1, 2, 11, 12, 21, 22]));

    expect(summary.taken).toBe(4);
    expect(await libraryOf(ana.id)).toBe(2);
    expect(await libraryOf(luis.id)).toBe(2);
    expect(await libraryOf(eva.id)).toBe(0);
  });

  it("stops at the budget of the day and holds the rest of that person until tomorrow", async () => {
    const ana = await newUser();
    const luis = await newUser();
    await setBudgetUsed(ana.id, 299);
    await upload(ana.id, [1, 2, 3]);
    await upload(luis.id, [11]);

    const summary = await run(provider([1, 2, 3, 11]));

    expect(summary).toMatchObject({ added: 2, dayOver: 1 });
    expect(await libraryOf(ana.id)).toBe(1);
    const waiting = (await rows()).filter((row) => row.user_id === ana.id);
    expect(waiting).toEqual([
      expect.objectContaining({ state: "pending", until_midnight: true }),
      expect.objectContaining({ state: "pending", until_midnight: true }),
    ]);
    // Nothing of hers is tried again now, and Luis is not held back by her.
    const again = await run(provider([2, 3]));
    expect(again.taken).toBe(0);
    expect(await libraryOf(luis.id)).toBe(1);
  });

  it("spends no budget on a title that is already in our database", async () => {
    const ana = await newUser();
    await upload(ana.id, [7]);
    await saveMedia(db, movie(7));
    await setBudgetUsed(ana.id, 300);

    const tmdb = provider([7]);
    const summary = await run(tmdb);

    expect(summary).toMatchObject({ added: 1, dayOver: 0 });
    expect(tmdb.getById).not.toHaveBeenCalled();
    expect(await libraryOf(ana.id)).toBe(1);
  });

  it("lists a title the provider does not know, with the reason, and keeps its unit spent", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2]);

    await run(provider([1]));

    expect(await rows()).toEqual([
      expect.objectContaining({
        title: "Movie 2",
        state: "skipped",
        reason: "not_found",
      }),
    ]);
    expect(await latestImportProgress(db, ana.id)).toMatchObject({
      total: 2,
      added: 1,
      pending: 0,
      skippedCount: 1,
      skipped: [{ title: "Movie 2", reason: "not_found" }],
    });
    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.titleFetchesCount).toBe(2);
  });

  it("gives the unit back when the provider does not answer, waits an hour, and lists it as failed after 3 tries", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2]);
    const tmdb = provider([1, 2], [2]);

    await run(tmdb);

    expect(await rows()).toEqual([
      expect.objectContaining({
        title: "Movie 2",
        state: "pending",
        attempts: 1,
        waits: true,
      }),
    ]);
    // One unit for the title that was saved; the one that failed went back.
    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.titleFetchesCount).toBe(1);

    for (const expected of [2, 3]) {
      await db.execute(sql`UPDATE import_rows SET retry_at = now()`);
      await run(tmdb);
      const [left] = await rows();
      expect(left).toMatchObject({ attempts: expected });
    }
    expect(await rows()).toEqual([
      expect.objectContaining({ state: "skipped", reason: "failed" }),
    ]);
    expect(
      (
        await db
          .select()
          .from(importRows)
          .where(eq(importRows.state, "skipped"))
      )[0]?.entry,
    ).toBeNull();
  });

  it("does not take a title that another run holds (its lease has not ended)", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2]);

    await run(provider([]));
    // The first run found nothing, so both were listed; make new ones and hold them.
    await upload(ana.id, [3, 4]);
    await db.execute(
      sql`UPDATE import_rows SET retry_at = now() + interval '10 minutes' WHERE state = 'pending'`,
    );

    expect((await run(provider([3, 4]))).taken).toBe(0);
  });

  it("works the oldest import of a person first", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2, 3, 4]);
    await upload(ana.id, [5]);

    await run(provider([1, 2, 3, 4, 5]));

    const left = await rows();
    // 3 of the first import were done; the second has not been touched.
    expect(left.map((row) => row.title)).toEqual(["Movie 4", "Movie 5"]);
  });

  it("keeps the choice to replace, made at the upload, for an entry the person got meanwhile", async () => {
    const ana = await newUser();
    await upload(ana.id, [1], { replace: true });
    // The title arrives in the library by another way while the import waits.
    const mediaId = await saveMedia(db, movie(1));
    await db
      .insert(libraryEntries)
      .values({ userId: ana.id, mediaId, status: "planned" });

    const summary = await run(provider([1]));

    expect(summary).toMatchObject({ added: 0, replaced: 1 });
    const [entryRow] = await db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.userId, ana.id));
    expect(entryRow).toMatchObject({ status: "completed", score: 8 });
  });

  it("replaces an entry the person has only when the import asked to", async () => {
    const ana = await newUser();
    const held = await saveMedia(db, movie(1));
    await db
      .insert(libraryEntries)
      .values({ userId: ana.id, mediaId: held, status: "planned" });
    // The upload finds the title held, so it is written there; a replace never reaches the queue.
    const result = await upload(ana.id, [1], { replace: true });
    expect(result).toMatchObject({ replaced: 1, queued: 0 });
  });
});

describe("what a run does when something goes wrong (SAG-241 review)", () => {
  it("does not let one person's failure hold back the others, and counts a try for the failed rows", async () => {
    const ana = await newUser();
    const luis = await newUser();
    await upload(ana.id, [1]);
    await upload(luis.id, [11]);
    // The database refuses every entry written for Ana, as a broken row would.
    await db.execute(sql`
      CREATE FUNCTION refuse_ana() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = ${sql.raw(`'${ana.id}'`)}::uuid THEN RAISE EXCEPTION 'refused'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.execute(
      sql`CREATE TRIGGER refuse_ana BEFORE INSERT ON library_entries
          FOR EACH ROW EXECUTE FUNCTION refuse_ana()`,
    );
    try {
      const summary = await run(provider([1, 11]));
      expect(summary.retried).toBe(1);
    } finally {
      await db.execute(sql`DROP TRIGGER refuse_ana ON library_entries`);
      await db.execute(sql`DROP FUNCTION refuse_ana()`);
    }

    expect(await libraryOf(luis.id)).toBe(1);
    expect(await libraryOf(ana.id)).toBe(0);
    expect(await rows()).toEqual([
      expect.objectContaining({ state: "pending", attempts: 1, waits: true }),
    ]);
  });

  it("does not let an older import that is only waiting hold back a newer one", async () => {
    const ana = await newUser();
    await upload(ana.id, [1]);
    await db.execute(
      sql`UPDATE import_rows SET retry_at = now() + interval '5 hours'`,
    );
    await upload(ana.id, [2]);

    const summary = await run(provider([1, 2]));

    expect(summary).toMatchObject({ taken: 1, added: 1 });
    expect(await libraryOf(ana.id)).toBe(1);
    expect((await rows()).map((row) => row.title)).toEqual(["Movie 1"]);
  });

  it("lists a title as not found, with no second try, when the provider saved it under another id", async () => {
    const ana = await newUser();
    await upload(ana.id, [1]);
    const tmdb = provider([]);
    vi.mocked(tmdb.getById).mockResolvedValue(movie(99));

    await run(tmdb);

    expect(await rows()).toEqual([
      expect.objectContaining({
        state: "skipped",
        reason: "not_found",
        attempts: 0,
      }),
    ]);
  });
});

describe("what the person is told (SAG-241)", () => {
  it("shows the latest import with what waits and the titles that went wrong", async () => {
    const ana = await newUser();
    await upload(ana.id, [1, 2, 3]);
    await run(provider([1], [2]));

    expect(await latestImportProgress(db, ana.id)).toMatchObject({
      total: 3,
      added: 1,
      // Movie 2 did not answer and waits an hour; Movie 3 is not known.
      pending: 1,
      skippedCount: 1,
      skipped: [{ title: "Movie 3", reason: "not_found" }],
    });
  });

  it("says nothing of another person's import", async () => {
    const ana = await newUser();
    const luis = await newUser();
    await upload(ana.id, [1]);
    expect(await latestImportProgress(db, luis.id)).toBeNull();
  });

  it("lists the titles left out in the upload with their reason", async () => {
    const ana = await newUser();
    const parsed = parseImportFile(
      JSON.stringify({
        schemaVersion: 1,
        libraryEntries: [
          entry(1),
          { title: "No id", status: "completed" },
          { ...entry(2), source: { provider: "mangadex", id: "abc" } },
        ],
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    await runImport({ db, providers: [provider([])] }, ana.id, parsed.value, {
      replace: false,
      locale: "es",
    });

    const progress = await latestImportProgress(db, ana.id);
    expect(progress).toMatchObject({ total: 3, pending: 1, skippedCount: 2 });
    expect(progress?.skipped.map((item) => item.reason).sort()).toEqual([
      "no_source",
      "unsupported_provider",
    ]);
  });
});

describe("the account and the cleanup (SAG-241)", () => {
  it("erases the import of a person with their account, and no batch takes it", async () => {
    const ana = await newUser({ clerkId: "user_import_erase" });
    await upload(ana.id, [1, 2]);

    await eraseAccount(db, "user_import_erase");

    expect(await rows()).toEqual([]);
    expect((await run(provider([1, 2]))).taken).toBe(0);
  });

  it("deletes the imports made more than 30 days ago, and only those", async () => {
    const ana = await newUser();
    await upload(ana.id, [1]);
    await upload(ana.id, [2]);
    await upload(ana.id, [3]);
    // Written by hand: one made 31 days ago goes, one made 29 days ago stays.
    await db.execute(
      sql`UPDATE import_jobs SET created_at = CASE
            WHEN id = (SELECT id FROM import_jobs ORDER BY id LIMIT 1) THEN now() - interval '31 days'
            WHEN id = (SELECT id FROM import_jobs ORDER BY id LIMIT 1 OFFSET 1) THEN now() - interval '29 days'
            ELSE created_at END`,
    );

    expect(await pruneImportJobs(db)).toBe(1);
    expect((await rows()).map((row) => row.title).sort()).toEqual([
      "Movie 2",
      "Movie 3",
    ]);
  });

  it("takes nothing from an account that was erased, even if its rows are still there", async () => {
    const ana = await newUser();
    await upload(ana.id, [1]);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect((await run(provider([1]))).taken).toBe(0);
  });
});
