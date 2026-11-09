import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addEntry, getEntry, saveEntry } from "../server/db/library";
import {
  applyStatus,
  applyStep,
  type EntryState,
} from "../server/library/rules";
import { updateEntry } from "../server/library/update-entry";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

// SAG-174: a step, a status change and a save used to write the whole entry back from a read that
// could be old. These tests run on the real Postgres, where two statements really do overlap.

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

const watching: EntryState = {
  status: "in_progress",
  progress: 5,
  progressUnit: null,
  progressTotal: null,
  score: 8,
  startedAt: "2026-01-01",
  finishedAt: null,
  notes: "Primera nota",
  visibility: "public",
};

// A title with no episodes in the catalog has no end, so a step is never refused.
const context = (type: string) => ({
  totalEpisodes: 0,
  type,
  today: "2026-11-09",
});

async function entryOf(state: EntryState = watching) {
  const ana = await newUser();
  const media = await newMedia({
    type: "anime",
    title: "Ataque a los Titanes",
  });
  await addEntry(db, ana.id, media.id);
  await saveEntry(db, ana.id, media.id, state);
  return { userId: ana.id, mediaId: media.id };
}

const step = (current: { type: string } & EntryState) =>
  applyStep(current, context(current.type));

describe("saveEntry with the version it read", () => {
  it("writes when nothing changed, and refuses when the entry changed after the read", async () => {
    const { userId, mediaId } = await entryOf();
    const read = await getEntry(db, userId, mediaId, "es");

    expect(
      await saveEntry(
        db,
        userId,
        mediaId,
        { ...watching, progress: 6 },
        read?.version,
      ),
    ).toBe("saved");
    // The same old version a second time: the row has moved on.
    expect(
      await saveEntry(
        db,
        userId,
        mediaId,
        { ...watching, progress: 99, notes: "pisada" },
        read?.version,
      ),
    ).toBe("conflict");

    expect(await getEntry(db, userId, mediaId, "es")).toMatchObject({
      progress: 6,
      notes: "Primera nota",
    });
  });

  it("matches a row written by the database itself, with microseconds", async () => {
    const { userId, mediaId } = await entryOf();
    await db.execute(
      sql`UPDATE library_entries SET updated_at = '2026-11-01 10:00:00.123456+00'`,
    );
    const read = await getEntry(db, userId, mediaId, "es");

    expect(read?.version).toBe("2026-11-01 10:00:00.123456");
    expect(await saveEntry(db, userId, mediaId, watching, read?.version)).toBe(
      "saved",
    );
  });

  it("says missing, not conflict, for an entry the person does not have", async () => {
    const { mediaId } = await entryOf();
    const beto = await newUser();

    expect(
      await saveEntry(db, beto.id, mediaId, watching, "2026-11-01 10:00:00"),
    ).toBe("missing");
  });
});

describe("updateEntry", () => {
  it("never brings back an old visibility: a step that read the entry before it became private steps on the private one", async () => {
    const { userId, mediaId } = await entryOf();
    let raced = false;

    const result = await updateEntry(db, userId, mediaId, async (current) => {
      if (!raced) {
        raced = true;
        // The person makes the entry private after the step read it as public.
        await saveEntry(db, userId, mediaId, {
          ...watching,
          visibility: "private",
        });
      }
      return step(current);
    });

    expect(result).toMatchObject({ outcome: "saved" });
    expect(await getEntry(db, userId, mediaId, "es")).toMatchObject({
      progress: 6,
      visibility: "private",
    });
  });

  it("gives N+2 when two steps are sent at the same time", async () => {
    const { userId, mediaId } = await entryOf();

    const results = await Promise.all([
      updateEntry(db, userId, mediaId, step),
      updateEntry(db, userId, mediaId, step),
    ]);

    expect(results.map((result) => result.outcome)).toEqual(["saved", "saved"]);
    expect(await getEntry(db, userId, mediaId, "es")).toMatchObject({
      progress: 7,
    });
  });

  it("does not undo the notes written while a status change was being worked out", async () => {
    const { userId, mediaId } = await entryOf();
    let raced = false;

    await updateEntry(db, userId, mediaId, async (current) => {
      if (!raced) {
        raced = true;
        await saveEntry(db, userId, mediaId, {
          ...watching,
          notes: "Nota nueva",
        });
      }
      return applyStatus(current, "paused", context(current.type));
    });

    expect(await getEntry(db, userId, mediaId, "es")).toMatchObject({
      status: "paused",
      notes: "Nota nueva",
    });
  });

  it("says conflict after a few lost races, and missing for an entry that is not there", async () => {
    const { userId, mediaId } = await entryOf();

    // Something changes the entry every time the step is worked out.
    const always = await updateEntry(db, userId, mediaId, async (current) => {
      await saveEntry(db, userId, mediaId, { ...watching, score: 1 });
      return step(current);
    });
    const beto = await newUser();
    const none = await updateEntry(db, beto.id, mediaId, step);

    expect(always).toEqual({ outcome: "conflict" });
    expect(none).toEqual({ outcome: "missing" });
    expect(await getEntry(db, userId, mediaId, "es")).toMatchObject({
      progress: 5,
    });
  });
});
