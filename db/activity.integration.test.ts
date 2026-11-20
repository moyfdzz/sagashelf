import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addEntry,
  getEntry,
  removeEntry,
  saveEntry,
} from "../server/db/library";
import {
  applyStatus,
  applyStep,
  type EntryState,
} from "../server/library/rules";
import { updateEntry } from "../server/library/update-entry";
import type { Level } from "../server/social/can-view";
import { exportAccount } from "../server/account/export";
import { createTestDb } from "./test-database";
import { factories, restartEntry, setEntry } from "./test-helpers";

// SAG-44, ADR-054: a change of the library writes its activity in the same statement.

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

const planned: EntryState = {
  status: "planned",
  progress: 0,
  progressUnit: null,
  progressTotal: null,
  score: null,
  startedAt: null,
  finishedAt: null,
  notes: null,
  visibility: "public",
};

const watching: EntryState = {
  ...planned,
  status: "in_progress",
  progress: 3,
  startedAt: "2026-11-01",
};

const context = { totalEpisodes: 12, type: "anime", today: "2026-11-20" };

/** A person with an entry in the given state, and no activity yet (the set-up writes some). */
async function entryOf(
  state: EntryState,
  privacy: Level = "public",
): Promise<{ userId: string; mediaId: string }> {
  const ana = await newUser({ privacy });
  const media = await newMedia({ type: "anime", title: "Frieren" });
  await addEntry(db, ana.id, media.id);
  await setEntry(db, ana.id, media.id, state);
  await db.execute(sql`DELETE FROM activity`);
  return { userId: ana.id, mediaId: media.id };
}

type Row = {
  id: string;
  type: string;
  visibility: string;
  payload: Record<string, unknown>;
  media_id: string | null;
};

async function events(userId: string): Promise<Row[]> {
  const { rows } = await db.execute(sql`
    SELECT id, type::text AS type, visibility::text AS visibility, payload, media_id
    FROM activity WHERE actor_id = ${userId}::uuid ORDER BY created_at, type
  `);
  return rows as Row[];
}

const step = (userId: string, mediaId: string) =>
  updateEntry(db, userId, mediaId, (current) => applyStep(current, context));

describe("the activity of a library change", () => {
  it("leaves one completed event when a title is completed, at the level of the entry", async () => {
    const { userId, mediaId } = await entryOf(watching);

    await updateEntry(db, userId, mediaId, (current) =>
      applyStatus(current, "completed", context),
    );

    expect(await events(userId)).toEqual([
      expect.objectContaining({
        type: "completed",
        visibility: "public",
        media_id: mediaId,
        payload: {},
      }),
    ]);
  });

  it.each([
    ["public", "friends", "friends"],
    ["friends", "public", "friends"],
    ["private", "public", "private"],
    ["public", "private", "private"],
    ["friends", "private", "private"],
  ] as const)(
    "stores the strictest level: entry %s and profile %s give %s",
    async (entryLevel, profileLevel, expected) => {
      const { userId, mediaId } = await entryOf(
        { ...watching, visibility: entryLevel },
        profileLevel,
      );

      await step(userId, mediaId);

      expect(await events(userId)).toEqual([
        expect.objectContaining({ type: "progressed", visibility: expected }),
      ]);
    },
  );

  it("starts a planned title with one started event", async () => {
    const { userId, mediaId } = await entryOf(planned);

    await updateEntry(db, userId, mediaId, (current) =>
      applyStatus(current, "in_progress", context),
    );

    expect(await events(userId)).toEqual([
      expect.objectContaining({ type: "started", payload: {} }),
    ]);
  });

  it("keeps ONE progress event a day: eight steps update it, with the last progress and the same id", async () => {
    const { userId, mediaId } = await entryOf(watching);

    await step(userId, mediaId);
    const [first] = await events(userId);
    for (let i = 0; i < 7; i += 1) await step(userId, mediaId);

    expect(await events(userId)).toEqual([
      {
        id: first?.id,
        type: "progressed",
        visibility: "public",
        media_id: mediaId,
        payload: { progress: 11, unit: "episodes" },
      },
    ]);
  });

  it("keeps the daily event of each title apart", async () => {
    const { userId, mediaId } = await entryOf(watching);
    const other = await newMedia({ type: "anime", title: "Otra" });
    await addEntry(db, userId, other.id);
    await setEntry(db, userId, other.id, watching);
    await db.execute(sql`DELETE FROM activity`);

    await step(userId, mediaId);
    await step(userId, other.id);

    expect((await events(userId)).map((row) => row.media_id).sort()).toEqual(
      [mediaId, other.id].sort(),
    );
  });

  it("adds a new progress event when the one there is from an earlier day (UTC)", async () => {
    const { userId, mediaId } = await entryOf(watching);
    await step(userId, mediaId);
    await db.execute(
      sql`UPDATE activity SET created_at = date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 second'`,
    );

    await step(userId, mediaId);

    expect((await events(userId)).map((row) => row.payload)).toEqual([
      { progress: 4, unit: "episodes" },
      { progress: 5, unit: "episodes" },
    ]);
  });

  it("keeps ONE rated event a day: 7, 8 and 7 again show once, with the last score", async () => {
    const { userId, mediaId } = await entryOf(watching);

    for (const score of [7, 8, 7]) {
      await setEntry(db, userId, mediaId, { ...watching, score });
    }

    expect(await events(userId)).toEqual([
      expect.objectContaining({ type: "rated", payload: { score: 7 } }),
    ]);
  });

  it("keeps ONE completed event a day when the status goes back and forth", async () => {
    const { userId, mediaId } = await entryOf(watching);

    for (const status of ["completed", "in_progress", "completed"] as const) {
      await updateEntry(db, userId, mediaId, (current) =>
        applyStatus(current, status, context),
      );
    }

    expect((await events(userId)).map((row) => row.type)).toEqual([
      "completed",
    ]);
  });

  it("deletes today's rated event when the score is taken away, and keeps an older one", async () => {
    const { userId, mediaId } = await entryOf(watching);
    await setEntry(db, userId, mediaId, { ...watching, score: 3 });
    await db.execute(
      sql`UPDATE activity SET created_at = created_at - interval '2 days'`,
    );
    await setEntry(db, userId, mediaId, { ...watching, score: 5 });

    await setEntry(db, userId, mediaId, { ...watching, score: null });

    expect(await events(userId)).toEqual([
      expect.objectContaining({ type: "rated", payload: { score: 3 } }),
    ]);
  });

  it("corrects today's progress when a step is undone, and adds nothing without one", async () => {
    const { userId, mediaId } = await entryOf(watching);
    await setEntry(db, userId, mediaId, { ...watching, progress: 2 });
    expect(await events(userId)).toEqual([]);

    await step(userId, mediaId);
    await step(userId, mediaId);
    await setEntry(db, userId, mediaId, { ...watching, progress: 3 });

    expect(await events(userId)).toEqual([
      expect.objectContaining({
        type: "progressed",
        payload: { progress: 3, unit: "episodes" },
      }),
    ]);
  });

  it("writes completed and rated together when one save does both", async () => {
    const { userId, mediaId } = await entryOf(watching);

    await setEntry(db, userId, mediaId, {
      ...watching,
      status: "completed",
      progress: 12,
      finishedAt: "2026-11-20",
      score: 9,
    });

    expect((await events(userId)).map((row) => row.type).sort()).toEqual([
      "completed",
      "rated",
    ]);
  });

  it("writes nothing for a change of notes, dates or visibility, nor for taking the score away", async () => {
    const { userId, mediaId } = await entryOf({ ...watching, score: 8 });

    await setEntry(db, userId, mediaId, {
      ...watching,
      score: null,
      notes: "Solo una nota",
      startedAt: "2026-10-01",
      visibility: "friends",
    });

    expect(await events(userId)).toEqual([]);
  });

  it("writes nothing when the write loses the race of the version", async () => {
    const { userId, mediaId } = await entryOf(watching);
    const read = await getEntry(db, userId, mediaId, "es");
    if (!read) throw new Error("The entry was not created");
    await setEntry(db, userId, mediaId, { ...watching, notes: "Otra pestaña" });
    await db.execute(sql`DELETE FROM activity`);

    expect(
      await saveEntry(
        db,
        userId,
        mediaId,
        { ...watching, status: "completed", progress: 12, score: 10 },
        read,
      ),
    ).toBe("conflict");
    expect(await events(userId)).toEqual([]);
  });

  it("does not update or delete today's events either when the write loses the race", async () => {
    const { userId, mediaId } = await entryOf(watching);
    await step(userId, mediaId);
    await setEntry(db, userId, mediaId, { ...watching, progress: 4, score: 9 });
    const read = await getEntry(db, userId, mediaId, "es");
    if (!read) throw new Error("The entry was not created");
    await setEntry(db, userId, mediaId, { ...read, notes: "Otra pestaña" });

    expect(
      await saveEntry(
        db,
        userId,
        mediaId,
        { ...read, progress: 9, score: null },
        read,
      ),
    ).toBe("conflict");
    expect(await events(userId)).toEqual([
      expect.objectContaining({
        type: "progressed",
        payload: { progress: 4, unit: "episodes" },
      }),
      expect.objectContaining({ type: "rated", payload: { score: 9 } }),
    ]);
  });

  it("writes a started event marked as a rewatch when a completed title starts again", async () => {
    const finished: EntryState = {
      ...watching,
      status: "completed",
      progress: 12,
      finishedAt: "2026-11-10",
    };
    const { userId, mediaId } = await entryOf(finished);

    expect(
      await restartEntry(db, userId, mediaId, {
        ...finished,
        status: "in_progress",
        progress: 0,
        startedAt: "2026-11-20",
        finishedAt: null,
      }),
    ).toBe("saved");

    expect(await events(userId)).toEqual([
      expect.objectContaining({ type: "started", payload: { rewatch: true } }),
    ]);
  });

  it("writes no event when a title is added as planned", async () => {
    const ana = await newUser();
    const media = await newMedia();

    await addEntry(db, ana.id, media.id);

    expect(await events(ana.id)).toEqual([]);
  });
});

describe("removing a title", () => {
  it("deletes the activity of that title only, and keeps the rest", async () => {
    const { userId, mediaId } = await entryOf(watching);
    const other = await newMedia({ title: "Otra" });
    await addEntry(db, userId, other.id);
    await setEntry(db, userId, other.id, watching);
    const beto = await newUser();
    await addEntry(db, beto.id, mediaId);
    await setEntry(db, beto.id, mediaId, watching);
    await step(userId, mediaId);

    expect(await removeEntry(db, userId, mediaId)).toBe(true);

    expect((await events(userId)).map((row) => row.media_id)).toEqual([
      other.id,
    ]);
    expect(await events(beto.id)).toHaveLength(1);
  });

  it("deletes nothing of somebody else when a person without the title removes it", async () => {
    const { userId, mediaId } = await entryOf(watching);
    await step(userId, mediaId);
    const beto = await newUser();

    expect(await removeEntry(db, beto.id, mediaId)).toBe(false);
    expect(await events(userId)).toHaveLength(1);
  });
});

describe("the export of the activity", () => {
  it("carries the person's own events, with the title, and nobody else's", async () => {
    const { userId, mediaId } = await entryOf({ ...watching, score: 8 });
    await step(userId, mediaId);
    const beto = await newUser();
    await addEntry(db, beto.id, mediaId);
    await setEntry(db, beto.id, mediaId, watching);

    const data = await exportAccount(db, userId);

    expect(data?.activity).toEqual([
      {
        type: "progressed",
        title: "Frieren",
        payload: { progress: 4, unit: "episodes" },
        visibility: "public",
        createdAt: expect.any(String),
      },
    ]);
  });
});
