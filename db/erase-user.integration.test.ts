import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import { eraseAccount, erasedColumns } from "../server/db/erase-user";
import {
  activity,
  blocks,
  customEntries,
  follows,
  libraryEntries,
  likes,
  listItems,
  lists,
  mediaItems,
  users,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

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

  await db.insert(libraryEntries).values({
    userId: ana.id,
    mediaId: movie.id,
    status: "completed",
    notes: "a private note",
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
  const [post] = await db
    .insert(activity)
    .values({ actorId: ana.id, type: "completed", mediaId: movie.id })
    .returning();
  if (!post) throw new Error("The post was not created");
  await db.insert(likes).values({ userId: bob.id, activityId: post.id });
  return { ana, bob, movie };
}

describe("eraseAccount", () => {
  it("erases what the person made and follows, and keeps what is not theirs", async () => {
    const { ana, bob, movie } = await personWithEverything();

    expect(await eraseAccount(db, "user_ana")).toBe(true);

    for (const table of [
      libraryEntries,
      customEntries,
      lists,
      listItems,
      follows,
      blocks,
      activity,
      likes,
    ]) {
      expect(await db.select().from(table), String(table)).toHaveLength(0);
    }
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

  it("covers every table that deletes with a user (a new table cannot be forgotten)", async () => {
    const { rows } = await db.execute(sql`
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.confrelid = 'users'::regclass
        AND c.confdeltype = 'c'
    `);
    const inDatabase = rows.map((r) => `${r.tbl}.${r.col}`).sort();
    const handled = erasedColumns
      .map(([table, column]) => `${table}.${column}`)
      .sort();

    expect(handled).toEqual(inDatabase);
  });
});

describe("exportAccount", () => {
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
    // No Clerk id, no role, no email, no id of the account, nothing of other people.
    const text = JSON.stringify(data);
    for (const secret of [
      "user_ana",
      "ana@example.test",
      "bob_reads",
      ana.id,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("gives nothing for an erased account", async () => {
    const { ana } = await personWithEverything();
    await eraseAccount(db, "user_ana");

    expect(await exportAccount(db, ana.id)).toBeNull();
  });
});
