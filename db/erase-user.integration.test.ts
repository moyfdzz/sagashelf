import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount, type AccountExport } from "../server/account/export";
import { eraseAccount, erasedColumns } from "../server/db/erase-user";
import {
  activity,
  blocks,
  customEntries,
  followRequests,
  follows,
  libraryEntries,
  libraryViewings,
  likes,
  listItems,
  lists,
  mediaItems,
  mutes,
  notifications,
  users,
  webhookEndpoints,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

/**
 * The columns that point at a person and stay when the account is erased, with the reason. The
 * row of an erased account stays too, without anything that says who it was (ADR-014).
 */
const keptColumns: Readonly<Record<string, string>> = {
  "reports.reporter_id":
    "a report outlives the person who made it, so a moderator can still act on it",
  "reports.resolved_by": "records which moderator closed a report",
  "audit_log.actor_id": "the audit log must not lose who did what",
  "picture_uploads.user_id":
    "deleting an account must not erase the trace of what it tried to publish; deleted after 90 days",
};

/** Where the export shows each erased column. Each one must hold rows for a full account. */
const exportedColumns: Readonly<
  Record<string, (data: AccountExport) => readonly unknown[]>
> = {
  "library_entries.user_id": (data) => data.libraryEntries,
  "custom_entries.owner_id": (data) => data.customEntries,
  "lists.owner_id": (data) => data.lists,
  "webhook_endpoints.user_id": (data) => data.webhooks,
  "notifications.user_id": (data) => data.notifications,
  "follows.follower_id": (data) => data.social.following,
  "blocks.blocker_id": (data) => data.social.blocked,
  "mutes.muter_id": (data) => data.social.muted,
  "follow_requests.requester_id": (data) => data.social.requestsSent,
  "follow_requests.target_id": (data) => data.social.requestsReceived,
};

/** The erased columns that the export leaves out, with the reason. */
const notExportedColumns: Readonly<Record<string, string>> = {
  "follows.followee_id": "who follows the person is what someone else did",
  "blocks.blocked_id": "who blocked the person is what someone else did",
  "mutes.muted_id": "who muted the person is what someone else did",
  "activity.actor_id":
    "no code writes it yet; SAG-22 must export it when it does",
  "likes.user_id": "no code writes it yet; SAG-22 must export it when it does",
};

const erasedNames = erasedColumns.map(
  ([table, column]) => `${table}.${column}`,
);

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, media_items, outbox, processed_webhooks RESTART IDENTITY CASCADE`,
  );
});

/** A person with something in every table that holds what a person makes or follows. */
async function personWithEverything() {
  const ana = await newUser({
    clerkId: "user_ana",
    username: "ana_reads",
    emailCanonical: "ana@example.test",
    displayName: "Ana",
    avatarUrl: "https://img.clerk.com/ana",
    bio: "private thoughts",
  });
  const bob = await newUser({ clerkId: "user_bob", username: "bob_reads" });
  const movie = await newMedia({ title: "A shared movie" });
  const mine = await newMedia({ title: "Ana's secret custom title" });

  const [entry] = await db
    .insert(libraryEntries)
    .values({
      userId: ana.id,
      mediaId: movie.id,
      status: "completed",
      notes: "a private note",
    })
    .returning();
  if (!entry) throw new Error("The entry was not created");
  await db.insert(libraryViewings).values({
    entryId: entry.id,
    finishedOn: "2025-05-03",
    notes: "an old viewing",
  });
  await db.insert(customEntries).values({ mediaId: mine.id, ownerId: ana.id });
  const [list] = await db
    .insert(lists)
    .values({ ownerId: ana.id, title: "Best of" })
    .returning();
  if (!list) throw new Error("The list was not created");
  await db
    .insert(listItems)
    .values({ listId: list.id, mediaId: movie.id, note: "ana's note" });
  await db.insert(follows).values([
    { followerId: ana.id, followeeId: bob.id },
    { followerId: bob.id, followeeId: ana.id },
  ]);
  await db.insert(blocks).values({ blockerId: ana.id, blockedId: bob.id });
  // Who each one muted (SAG-21): both directions are erased with the account.
  await db.insert(mutes).values([
    { muterId: ana.id, mutedId: bob.id },
    { muterId: bob.id, mutedId: ana.id },
  ]);
  // Requests to follow (SAG-108): both directions are erased with the account.
  await db.insert(followRequests).values([
    { requesterId: ana.id, targetId: bob.id },
    { requesterId: bob.id, targetId: ana.id },
  ]);
  const [post] = await db
    .insert(activity)
    .values({ actorId: ana.id, type: "completed", mediaId: movie.id })
    .returning();
  if (!post) throw new Error("The post was not created");
  await db.insert(likes).values({ userId: bob.id, activityId: post.id });
  // What the inbox told them (SAG-102): one read and one unread, and one of the other person.
  await db.insert(notifications).values([
    {
      userId: ana.id,
      type: "episode.aired",
      payload: { title: "Ana's private watching", mediaId: movie.id },
      dedupeKey: "episode:ana:1",
    },
    {
      userId: ana.id,
      type: "episode.aired",
      payload: { title: "Another one" },
      dedupeKey: "episode:ana:2",
      readAt: new Date("2026-11-03T12:00:00Z"),
    },
    {
      userId: bob.id,
      type: "episode.aired",
      payload: { title: "Bob's one" },
      dedupeKey: "episode:bob:1",
    },
  ]);
  await db.insert(webhookEndpoints).values({
    userId: ana.id,
    kind: "discord",
    url: "https://discord.com/api/webhooks/1/not-a-real-token",
    eventTypes: ["library.completed"],
  });
  return { ana, bob, movie };
}

describe("eraseAccount", () => {
  it("erases what the person made and follows, and keeps what is not theirs", async () => {
    const { ana, bob, movie } = await personWithEverything();

    expect(await eraseAccount(db, "user_ana")).toBe(true);

    for (const table of [
      libraryEntries,
      libraryViewings,
      customEntries,
      lists,
      listItems,
      follows,
      blocks,
      mutes,
      followRequests,
      activity,
      likes,
    ]) {
      expect(await db.select().from(table), String(table)).toHaveLength(0);
    }
    // Their notifications are gone and the other person's stays.
    const left = await db.select().from(notifications);
    expect(left.map((row) => row.userId)).toEqual([bob.id]);
    // The shared title stays; the title the person wrote is gone with their entry.
    const titles = (await db.select().from(mediaItems)).map((m) => m.title);
    expect(titles).toEqual([movie.title]);
    // The other person keeps their account.
    const [other] = await db.select().from(users).where(eq(users.id, bob.id));
    expect(other?.username).toBe("bob_reads");
    expect(ana.id).not.toBe(bob.id);
  });

  it("leaves no name, no email, no bio and no photo, and frees the username and the email", async () => {
    await personWithEverything();
    await eraseAccount(db, "user_ana");

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, "user_ana"));
    expect(row).toMatchObject({
      displayName: null,
      avatarUrl: null,
      bio: null,
      privacy: "private",
    });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.username).toMatch(/^deleted-[0-9a-f]{12}$/);
    expect(row?.emailCanonical).toBe(`deleted:${row?.id}`);

    // The username and the email can be used by a new account.
    const again = await newUser({
      clerkId: "user_ana_again",
      username: "ana_reads",
      emailCanonical: "ana@example.test",
    });
    expect(again.username).toBe("ana_reads");
  });

  it("does nothing the second time and for an unknown account", async () => {
    await personWithEverything();

    expect(await eraseAccount(db, "user_ana")).toBe(true);
    expect(await eraseAccount(db, "user_ana")).toBe(false);
    expect(await eraseAccount(db, "user_nobody")).toBe(false);
  });

  it("is atomic: the account stays whole if a statement fails", async () => {
    const { ana } = await personWithEverything();
    // A trigger that refuses to delete a follow makes the statement fail.
    await db.execute(sql`
      CREATE FUNCTION refuse_follow_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER refuse_follow_delete BEFORE DELETE ON follows
      FOR EACH ROW EXECUTE FUNCTION refuse_follow_delete()
    `);
    try {
      await expect(eraseAccount(db, "user_ana")).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER refuse_follow_delete ON follows`);
      await db.execute(sql`DROP FUNCTION refuse_follow_delete()`);
    }

    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row).toMatchObject({ displayName: "Ana", bio: "private thoughts" });
    expect(row?.deletedAt).toBeNull();
    expect(await db.select().from(libraryEntries)).toHaveLength(1);
  });

  it("erases or explains every column that points at a person (a new one cannot be forgotten)", async () => {
    const { rows } = await db.execute(sql`
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.confrelid = 'users'::regclass
    `);
    const inDatabase = rows.map((r) => `${r.tbl}.${r.col}`).sort();
    const handled = [...erasedNames, ...Object.keys(keptColumns)].sort();

    expect(handled).toEqual(inDatabase);
  });
});

describe("exportAccount", () => {
  it("says where each erased column is exported, or why it is not", () => {
    const classified = [
      ...Object.keys(exportedColumns),
      ...Object.keys(notExportedColumns),
    ].sort();

    expect(classified).toEqual([...erasedNames].sort());
  });

  it("really has rows for each column it says it exports", async () => {
    const { ana } = await personWithEverything();

    const data = await exportAccount(db, ana.id);
    if (!data) throw new Error("The export is empty");

    for (const [column, read] of Object.entries(exportedColumns)) {
      expect(read(data).length, column).toBeGreaterThan(0);
    }
  });

  it("gives the person their own data and nobody else's", async () => {
    const { ana } = await personWithEverything();

    const data = await exportAccount(
      db,
      ana.id,
      new Date("2026-10-24T00:00:00Z"),
    );

    expect(data?.profile).toMatchObject({
      username: "ana_reads",
      displayName: "Ana",
      bio: "private thoughts",
    });
    expect(data?.libraryEntries).toMatchObject([
      { title: "A shared movie", status: "completed", notes: "a private note" },
    ]);
    expect(data?.customEntries).toMatchObject([
      { title: "Ana's secret custom title" },
    ]);
    expect(data?.lists).toMatchObject([
      {
        title: "Best of",
        items: [{ title: "A shared movie", note: "ana's note" }],
      },
    ]);
    // The notifications: both of hers, with what each said and when it was read, and not Bob's.
    expect(data?.notifications).toHaveLength(2);
    expect(data?.notifications).toContainEqual({
      type: "episode.aired",
      payload: { title: "Another one" },
      createdAt: expect.any(String),
      readAt: "2026-11-03T12:00:00.000Z",
    });
    expect(JSON.stringify(data?.notifications)).not.toContain("Bob's one");
    // Whom she follows, blocked and muted, by username; never who follows her, and never the mute
    // that Bob made of her.
    expect(data?.social).toEqual({
      following: [{ username: "bob_reads", since: expect.any(String) }],
      blocked: [{ username: "bob_reads", since: expect.any(String) }],
      muted: [{ username: "bob_reads", since: expect.any(String) }],
      requestsSent: [{ username: "bob_reads", since: expect.any(String) }],
      requestsReceived: [{ username: "bob_reads", since: expect.any(String) }],
    });
    // No Clerk id, no role, no email, no id of the account, nothing of other people.
    const text = JSON.stringify(data);
    for (const secret of ["user_ana", "ana@example.test", ana.id]) {
      expect(text).not.toContain(secret);
    }
    // Bob's username is only in the lists of what she did to him, and nowhere else.
    const { social, ...rest } = data ?? { social: null };
    expect(JSON.stringify(rest)).not.toContain("bob_reads");
    expect(JSON.stringify(social)).toContain("bob_reads");
  });

  it("gives nothing for an erased account", async () => {
    const { ana } = await personWithEverything();
    await eraseAccount(db, "user_ana");

    expect(await exportAccount(db, ana.id)).toBeNull();
  });
});
