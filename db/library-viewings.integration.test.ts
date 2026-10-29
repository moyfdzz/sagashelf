import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import {
  addEntry,
  listLibrary,
  removeEntry,
  rewatchEntry,
  saveEntry,
} from "../server/db/library";
import { saveMedia } from "../server/db/media-store";
import { libraryEntries, libraryViewings, users } from "../server/db/schema";
import {
  addViewing,
  listViewings,
  maxViewings,
  removeViewing,
  saveViewing,
} from "../server/db/viewings";
import type { EntryState } from "../server/library/rules";
import { libraryQuerySchema } from "../server/library/schema";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

let counter = 0;
async function addMedia(title: string): Promise<string> {
  counter += 1;
  return saveMedia(db, {
    type: "movie",
    title,
    originalTitle: null,
    year: 2014,
    synopsis: {},
    imageUrl: null,
    status: "finished",
    popularity: 1,
    externalId: { provider: "tmdb", id: `movie/${counter}` },
  });
}

const completed: EntryState = {
  status: "completed",
  progress: 0,
  progressUnit: null,
  progressTotal: null,
  score: 9,
  startedAt: "2026-01-01",
  finishedAt: "2026-02-01",
  notes: null,
  visibility: "private",
};

const restarted: EntryState = {
  ...completed,
  status: "in_progress",
  startedAt: "2026-10-26",
  finishedAt: null,
};

const noViewing = { startedOn: null, finishedOn: null, notes: null };

/** A person with a completed entry for a new title. */
async function watched() {
  const ana = await newUser();
  const mediaId = await addMedia("Interestelar");
  await addEntry(db, ana.id, mediaId);
  await saveEntry(db, ana.id, mediaId, completed);
  return { ana, mediaId };
}

const query = libraryQuerySchema.parse({});

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}

describe("rewatchEntry", () => {
  it("saves the run that ends with its dates and restarts the entry, in one step", async () => {
    const { ana, mediaId } = await watched();

    expect(await rewatchEntry(db, ana.id, mediaId, restarted)).toBe(true);

    expect(await listViewings(db, ana.id, mediaId)).toEqual([
      expect.objectContaining({
        startedOn: "2026-01-01",
        finishedOn: "2026-02-01",
      }),
    ]);
    const [entry] = await db.select().from(libraryEntries);
    expect(entry).toMatchObject({
      status: "in_progress",
      startedAt: "2026-10-26",
      finishedAt: null,
      score: 9,
    });
  });

  it("does nothing, and saves no viewing, for a title that is not completed", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Interestelar");
    await addEntry(db, ana.id, mediaId);

    expect(await rewatchEntry(db, ana.id, mediaId, restarted)).toBe(false);

    expect(await db.select().from(libraryViewings)).toHaveLength(0);
  });

  it("does not restart somebody else's entry", async () => {
    const { mediaId } = await watched();
    const beto = await newUser();

    expect(await rewatchEntry(db, beto.id, mediaId, restarted)).toBe(false);

    expect(await db.select().from(libraryViewings)).toHaveLength(0);
    const [entry] = await db.select().from(libraryEntries);
    expect(entry?.status).toBe("completed");
  });

  it("stops at the most viewings an entry can hold, and leaves the entry as it was", async () => {
    const { ana, mediaId } = await watched();
    for (let i = 0; i < maxViewings; i += 1) {
      await addViewing(db, ana.id, mediaId, noViewing);
    }

    expect(await rewatchEntry(db, ana.id, mediaId, restarted)).toBe(false);

    const [entry] = await db.select().from(libraryEntries);
    expect(entry?.status).toBe("completed");
  });
});

describe("times watched in the list", () => {
  it("counts the earlier viewings and the current run when it is completed", async () => {
    const { ana, mediaId } = await watched();
    const times = async () =>
      (await listLibrary(db, ana.id, query, "es")).sections.flatMap(
        (section) => section.rows,
      )[0]?.timesWatched;

    expect(await times()).toBe(1);
    await rewatchEntry(db, ana.id, mediaId, restarted);
    // One earlier viewing, and the current run is not finished.
    expect(await times()).toBe(1);
    await saveEntry(db, ana.id, mediaId, {
      ...completed,
      startedAt: "2026-10-26",
      finishedAt: "2026-11-01",
    });
    expect(await times()).toBe(2);
  });

  it("counts an earlier viewing added by hand on a title that is not completed", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Interestelar");
    await addEntry(db, ana.id, mediaId);

    await addViewing(db, ana.id, mediaId, noViewing);

    expect(
      (await listLibrary(db, ana.id, query, "es")).sections.flatMap(
        (section) => section.rows,
      )[0]?.timesWatched,
    ).toBe(1);
  });
});

describe("the viewings of an entry", () => {
  it("adds, lists the latest first, changes and removes", async () => {
    const { ana, mediaId } = await watched();
    await addViewing(db, ana.id, mediaId, {
      startedOn: "2024-05-01",
      finishedOn: "2024-05-03",
      notes: "En el cine",
    });
    await addViewing(db, ana.id, mediaId, {
      startedOn: "2025-08-01",
      finishedOn: "2025-08-02",
      notes: null,
    });

    const listed = await listViewings(db, ana.id, mediaId);
    expect(listed.map((viewing) => viewing.finishedOn)).toEqual([
      "2025-08-02",
      "2024-05-03",
    ]);

    const [latest, older] = listed;
    expect(
      await saveViewing(db, ana.id, mediaId, must(older).id, {
        startedOn: "2024-05-01",
        finishedOn: "2024-05-04",
        notes: null,
      }),
    ).toBe(true);
    expect(await removeViewing(db, ana.id, mediaId, must(latest).id)).toBe(
      true,
    );

    expect(await listViewings(db, ana.id, mediaId)).toEqual([
      {
        id: must(older).id,
        startedOn: "2024-05-01",
        finishedOn: "2024-05-04",
        notes: null,
      },
    ]);
  });

  it("accepts a viewing with no dates", async () => {
    const { ana, mediaId } = await watched();

    expect(await addViewing(db, ana.id, mediaId, noViewing)).toBe("ok");
  });

  it("never lets a person read, change or remove the viewing of somebody else", async () => {
    const { ana, mediaId } = await watched();
    await addViewing(db, ana.id, mediaId, { ...noViewing, notes: "Mia" });
    const [viewing] = await listViewings(db, ana.id, mediaId);
    const beto = await newUser();
    await addEntry(db, beto.id, mediaId);

    expect(await listViewings(db, beto.id, mediaId)).toEqual([]);
    expect(
      await saveViewing(db, beto.id, mediaId, must(viewing).id, {
        ...noViewing,
        notes: "De Beto",
      }),
    ).toBe(false);
    expect(await removeViewing(db, beto.id, mediaId, must(viewing).id)).toBe(
      false,
    );
    // The id of the viewing with the title of another entry of the same person does not work either.
    const other = await addMedia("Origen");
    await addEntry(db, ana.id, other);
    expect(await removeViewing(db, ana.id, other, must(viewing).id)).toBe(
      false,
    );

    expect(await listViewings(db, ana.id, mediaId)).toEqual([
      expect.objectContaining({ notes: "Mia" }),
    ]);
  });

  it("says there is no entry when the person has none for the title", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Interestelar");

    expect(await addViewing(db, ana.id, mediaId, noViewing)).toBe("missing");
  });

  it("holds at most the limit", async () => {
    const { ana, mediaId } = await watched();

    for (let i = 0; i < maxViewings; i += 1) {
      expect(await addViewing(db, ana.id, mediaId, noViewing)).toBe("ok");
    }

    expect(await addViewing(db, ana.id, mediaId, noViewing)).toBe("limit");
    expect(await db.select().from(libraryViewings)).toHaveLength(maxViewings);
  });

  it("goes away with the entry and with the account", async () => {
    const { ana, mediaId } = await watched();
    await addViewing(db, ana.id, mediaId, noViewing);
    await removeEntry(db, ana.id, mediaId);
    expect(await db.select().from(libraryViewings)).toHaveLength(0);

    await addEntry(db, ana.id, mediaId);
    await addViewing(db, ana.id, mediaId, noViewing);
    await db.delete(users).where(eq(users.id, ana.id));
    expect(await db.select().from(libraryViewings)).toHaveLength(0);
  });
});

describe("the constraints of library_viewings", () => {
  async function insert(values: Partial<typeof libraryViewings.$inferInsert>) {
    const { ana, mediaId } = await watched();
    void mediaId;
    const [entry] = await db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.userId, ana.id));
    return failsWith(
      db.insert(libraryViewings).values({ entryId: must(entry).id, ...values }),
    );
  }

  it("refuses a viewing that ends before it starts", async () => {
    expect(
      (await insert({ startedOn: "2025-05-02", finishedOn: "2025-05-01" }))
        .code,
    ).toBe("23514");
  });

  it("refuses notes over 500 characters", async () => {
    expect((await insert({ notes: "x".repeat(501) })).code).toBe("23514");
  });

  it("refuses a viewing of an entry that does not exist", async () => {
    expect(
      (
        await failsWith(
          db.insert(libraryViewings).values({
            entryId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
          }),
        )
      ).code,
    ).toBe("23503");
  });
});

describe("the data export", () => {
  it("has the viewings of each entry, the times watched, and never an id", async () => {
    const { ana, mediaId } = await watched();
    await addViewing(db, ana.id, mediaId, {
      startedOn: "2024-05-01",
      finishedOn: "2024-05-03",
      notes: "En el cine",
    });

    const data = await exportAccount(db, ana.id);

    expect(data?.libraryEntries).toEqual([
      expect.objectContaining({
        timesWatched: 2,
        viewings: [
          {
            startedOn: "2024-05-01",
            finishedOn: "2024-05-03",
            notes: "En el cine",
          },
        ],
      }),
    ]);
    const text = JSON.stringify(data);
    const [entry] = await db.select().from(libraryEntries);
    expect(text).not.toContain(must(entry).id);
    expect(text).not.toContain(mediaId);
  });
});
