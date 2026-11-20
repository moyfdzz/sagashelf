import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  feedPageSize,
  readFeed,
  setLike,
  type FeedCursor,
} from "../server/db/feed";
import type { Level } from "../server/social/can-view";
import { exportAccount } from "../server/account/export";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

// SAG-22, ADR-055: the feed of /social and its likes, against the real Postgres.

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

let minutes = 0;

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
  minutes = 0;
});

type Person = { id: string; username: string };

async function person(privacy: Level = "public"): Promise<Person> {
  const row = await newUser({ privacy });
  return { id: row.id, username: row.username };
}

async function follow(follower: Person, followee: Person) {
  await db.execute(
    sql`INSERT INTO follows (follower_id, followee_id) VALUES (${follower.id}::uuid, ${followee.id}::uuid)`,
  );
}

/**
 * An event of `actor` on a new title with an entry of the given level. Each one is a minute later
 * than the one before, so the order of the feed is the order they were made in.
 */
async function eventOf(
  actor: Person,
  options: {
    event?: Level;
    entry?: Level;
    type?: string;
    mediaType?: "anime" | "custom";
  } = {},
): Promise<{ id: string; mediaId: string }> {
  const media = await newMedia({
    type: options.mediaType ?? "anime",
    title: `Title ${minutes}`,
  });
  // Written by hand: `addEntry` refuses a custom title, and the test of that rule needs an entry.
  await db.execute(sql`
    INSERT INTO library_entries (user_id, media_id, status, visibility)
    VALUES (${actor.id}::uuid, ${media.id}::uuid, 'completed',
            ${options.entry ?? "public"}::privacy_level)`);
  minutes += 1;
  const { rows } = await db.execute(sql`
    INSERT INTO activity (actor_id, type, media_id, payload, visibility, created_at)
    VALUES (${actor.id}::uuid, ${options.type ?? "completed"}::activity_type, ${media.id}::uuid,
            '{}'::jsonb, ${options.event ?? "public"}::privacy_level,
            '2026-11-20T00:00:00Z'::timestamptz + ${minutes} * interval '1 minute')
    RETURNING id`);
  return { id: String(rows[0]?.id), mediaId: media.id };
}

const feedOf = async (viewer: Person, before: FeedCursor | null = null) =>
  readFeed(db, viewer.id, "es", before);

const idsOf = async (viewer: Person) =>
  (await feedOf(viewer)).events.map((event) => event.id);

describe("who sees an event in the feed", () => {
  it("shows a public event to a follower, with its author, title and level", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    const event = await eventOf(ana);

    const { events, next } = await feedOf(bea);

    expect(next).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        id: event.id,
        type: "completed",
        level: "public",
        mine: false,
        likes: 0,
        liked: false,
        actor: expect.objectContaining({ username: ana.username }),
        media: expect.objectContaining({
          id: event.mediaId,
          type: "anime",
          title: "Title 0",
        }),
      }),
    ]);
  });

  // The strictest of the event, the entry and the profile decides, for a follower who is not a
  // friend and for a friend. Written by hand from ADR-031: friends see friends, nobody sees private.
  it.each<[Level, Level, Level, boolean, boolean]>([
    // event, entry, profile, follower sees, friend sees
    ["public", "public", "public", true, true],
    ["friends", "public", "public", false, true],
    ["public", "friends", "public", false, true],
    ["public", "public", "friends", false, true],
    ["private", "public", "public", false, false],
    ["public", "private", "public", false, false],
    ["public", "public", "private", false, false],
    ["friends", "friends", "friends", false, true],
  ])(
    "event %s, entry %s, profile %s: follower %s, friend %s",
    async (eventLevel, entryLevel, profileLevel, followerSees, friendSees) => {
      const ana = await person(profileLevel);
      const [follower, friend] = [await person(), await person()];
      await follow(follower, ana);
      await follow(friend, ana);
      await follow(ana, friend);
      const event = await eventOf(ana, {
        event: eventLevel,
        entry: entryLevel,
      });

      expect(await idsOf(follower)).toEqual(followerSees ? [event.id] : []);
      expect(await idsOf(friend)).toEqual(friendSees ? [event.id] : []);
    },
  );

  it("hides an old event once its entry is made more private", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    const event = await eventOf(ana);
    expect(await idsOf(bea)).toEqual([event.id]);

    await db.execute(sql`
      UPDATE library_entries SET visibility = 'private'
      WHERE media_id = ${event.mediaId}::uuid`);

    expect(await idsOf(bea)).toEqual([]);
  });

  it("never shows an event whose entry is gone (the race of ADR-054)", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    const event = await eventOf(ana);

    await db.execute(
      sql`DELETE FROM library_entries WHERE media_id = ${event.mediaId}::uuid`,
    );

    expect(await idsOf(bea)).toEqual([]);
    expect(await idsOf(ana)).toEqual([]);
  });

  it("shows nothing of a person the viewer does not follow, even public", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(ana, bea);
    await eventOf(ana);

    expect(await idsOf(bea)).toEqual([]);
  });

  it("hides a muted person, and a block either way", async () => {
    const [ana, muter, blocker, blocked] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    for (const viewer of [muter, blocker, blocked]) await follow(viewer, ana);
    await eventOf(ana);
    await db.execute(sql`
      INSERT INTO mutes (muter_id, muted_id) VALUES (${muter.id}::uuid, ${ana.id}::uuid)`);
    await db.execute(sql`
      INSERT INTO blocks (blocker_id, blocked_id) VALUES
        (${blocker.id}::uuid, ${ana.id}::uuid), (${ana.id}::uuid, ${blocked.id}::uuid)`);

    expect(await idsOf(muter)).toEqual([]);
    expect(await idsOf(blocker)).toEqual([]);
    expect(await idsOf(blocked)).toEqual([]);
  });

  it("hides an erased author", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    await eventOf(ana);

    await db.execute(
      sql`UPDATE users SET deleted_at = now() WHERE id = ${ana.id}::uuid`,
    );

    expect(await idsOf(bea)).toEqual([]);
  });

  it("never shows a title a person made for themselves, nor a kind the feed does not show", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    await eventOf(ana, { mediaType: "custom" });
    await eventOf(ana, { type: "list_created" });

    expect(await idsOf(bea)).toEqual([]);
  });

  it("shows the viewer their own events at any level, marked as theirs", async () => {
    const ana = await person("friends");
    const event = await eventOf(ana, { entry: "private" });

    expect((await feedOf(ana)).events).toEqual([
      expect.objectContaining({ id: event.id, level: "private", mine: true }),
    ]);
  });
});

describe("the pages of the feed", () => {
  it("reads newest first, a page at a time, without repeating or skipping one", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    const made: string[] = [];
    for (let index = 0; index < feedPageSize + 5; index += 1) {
      made.push((await eventOf(ana)).id);
    }
    const newestFirst = [...made].reverse();

    const first = await feedOf(bea);
    expect(first.events.map((event) => event.id)).toEqual(
      newestFirst.slice(0, feedPageSize),
    );
    expect(first.next).not.toBeNull();

    const second = await feedOf(bea, first.next);
    expect(second.events.map((event) => event.id)).toEqual(
      newestFirst.slice(feedPageSize),
    );
    expect(second.next).toBeNull();
  });

  it("keeps the order of events made in the same microsecond, by id", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    for (let index = 0; index < feedPageSize + 2; index += 1) {
      await eventOf(ana);
    }
    await db.execute(
      sql`UPDATE activity SET created_at = '2026-11-20T12:00:00.123456Z'`,
    );
    const { rows } = await db.execute(
      sql`SELECT id FROM activity ORDER BY id DESC`,
    );
    const byId = rows.map((row) => String(row.id));

    const first = await feedOf(bea);
    const second = await feedOf(bea, first.next);

    expect(
      [...first.events, ...second.events].map((event) => event.id),
    ).toEqual(byId);
  });
});

describe("likes", () => {
  async function likesOf(eventId: string) {
    const { rows } = await db.execute(
      sql`SELECT user_id FROM likes WHERE activity_id = ${eventId}::uuid ORDER BY user_id`,
    );
    return rows.map((row) => String(row.user_id));
  }

  it("likes an event once, counts it, and takes it back", async () => {
    const [ana, bea, cris] = [await person(), await person(), await person()];
    await follow(bea, ana);
    await follow(cris, ana);
    const event = await eventOf(ana);

    expect(await setLike(db, bea.id, event.id, true)).toEqual({ likes: 1 });
    expect(await setLike(db, bea.id, event.id, true)).toEqual({ likes: 1 });
    expect(await setLike(db, cris.id, event.id, true)).toEqual({ likes: 2 });
    expect(await likesOf(event.id)).toEqual([bea.id, cris.id].sort());

    const [shown] = (await feedOf(bea)).events;
    expect(shown).toEqual(expect.objectContaining({ likes: 2, liked: true }));

    expect(await setLike(db, bea.id, event.id, false)).toEqual({ likes: 1 });
    expect(await setLike(db, bea.id, event.id, false)).toEqual({ likes: 1 });
    expect(await likesOf(event.id)).toEqual([cris.id]);
  });

  it("refuses a like on the viewer's own event", async () => {
    const ana = await person();
    const event = await eventOf(ana);

    expect(await setLike(db, ana.id, event.id, true)).toBeNull();
    expect(await likesOf(event.id)).toEqual([]);
  });

  it("refuses a like on an event the feed would not show, and on one that does not exist", async () => {
    const [ana, follower, stranger] = [
      await person(),
      await person(),
      await person(),
    ];
    await follow(follower, ana);
    const friendsOnly = await eventOf(ana, { event: "friends" });
    const open = await eventOf(ana);

    expect(await setLike(db, follower.id, friendsOnly.id, true)).toBeNull();
    expect(await setLike(db, stranger.id, open.id, true)).toBeNull();
    expect(
      await setLike(
        db,
        follower.id,
        "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
        true,
      ),
    ).toBeNull();
    expect(await likesOf(friendsOnly.id)).toEqual([]);
    expect(await likesOf(open.id)).toEqual([]);
  });

  it("takes a like back even when the event can no longer be seen", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    const event = await eventOf(ana);
    await setLike(db, bea.id, event.id, true);
    await db.execute(sql`
      INSERT INTO blocks (blocker_id, blocked_id) VALUES (${ana.id}::uuid, ${bea.id}::uuid)`);

    expect(await setLike(db, bea.id, event.id, false)).toBeNull();
    expect(await likesOf(event.id)).toEqual([]);
  });

  it("goes in the export of the person who liked: the kind and the title, never a custom title", async () => {
    const [ana, bea] = [await person(), await person()];
    await follow(bea, ana);
    const shared = await eventOf(ana);
    const custom = await eventOf(ana, { mediaType: "custom" });
    await setLike(db, bea.id, shared.id, true);
    // The feed never shows a custom title, so a like on one can only be written by hand.
    await db.execute(sql`
      INSERT INTO likes (user_id, activity_id, created_at)
      VALUES (${bea.id}::uuid, ${custom.id}::uuid, now() + interval '1 minute')`);

    const data = await exportAccount(db, bea.id);

    expect(data?.likes).toEqual([
      { type: "completed", title: "Title 0", createdAt: expect.any(String) },
      { type: "completed", title: null, createdAt: expect.any(String) },
    ]);
    expect(JSON.stringify(data?.likes)).not.toContain(ana.username);
  });
});
