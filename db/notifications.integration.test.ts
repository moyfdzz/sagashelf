import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  pageSize,
} from "../server/db/notifications";
import { notifications, users } from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

let counter = 0;
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000);

async function notify(
  userId: string,
  overrides: Partial<typeof notifications.$inferInsert> = {},
) {
  counter += 1;
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      type: "episode.aired",
      payload: { title: `Title ${counter}`, season: 1, number: counter },
      dedupeKey: `episode:${counter}`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("The notification was not created");
  return row;
}

describe("the table of notifications (SAG-102)", () => {
  it("accepts a notification and starts it unread", async () => {
    const person = await newUser();

    const row = await notify(person.id);

    expect(row.readAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("refuses the same key twice for one person, and allows it for another", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await notify(ana.id, { dedupeKey: "episode:same" });

    const duplicate = await failsWith(
      notify(ana.id, { dedupeKey: "episode:same" }),
    );
    await notify(ben.id, { dedupeKey: "episode:same" });

    expect(duplicate).toEqual({
      code: "23505",
      constraint: "notifications_user_dedupe_unique",
    });
  });

  it("refuses a type nobody knows", async () => {
    const person = await newUser();

    expect(await failsWith(notify(person.id, { type: "made.up" }))).toEqual({
      code: "23514",
      constraint: "notifications_type_check",
    });
  });

  it("refuses a notification of a person that does not exist", async () => {
    expect(
      await failsWith(notify("0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f")),
    ).toMatchObject({ code: "23503" });
  });

  it("goes away with the person (the cascade that the erasure of the account relies on)", async () => {
    const person = await newUser();
    await notify(person.id);

    await db.delete(users).where(eq(users.id, person.id));

    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe("listNotifications", () => {
  it("lists the newest first, and only the person's own", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await notify(ana.id, { createdAt: minutesAgo(30), dedupeKey: "old" });
    await notify(ana.id, { createdAt: minutesAgo(5), dedupeKey: "new" });
    await notify(ben.id, { createdAt: minutesAgo(1), dedupeKey: "his" });

    const rows = await listNotifications(db, ana.id);

    expect(rows.map((row) => minutesAgoOf(row.createdAt))).toEqual([5, 30]);
    expect(rows).toHaveLength(2);
  });

  it("gives the payload back as an object and the read date as a date or null", async () => {
    const person = await newUser();
    await notify(person.id, {
      payload: { title: "A", number: 3 },
      readAt: minutesAgo(1),
      dedupeKey: "a",
    });
    await notify(person.id, { dedupeKey: "b", createdAt: minutesAgo(10) });

    const [first, second] = await listNotifications(db, person.id);

    expect(first?.readAt).toBeInstanceOf(Date);
    expect(first?.payload).toMatchObject({ title: "A", number: 3 });
    expect(second?.readAt).toBeNull();
  });

  it("shows at most one page", async () => {
    const person = await newUser();
    await db.insert(notifications).values(
      Array.from({ length: pageSize + 5 }, (_, index) => ({
        userId: person.id,
        type: "episode.aired",
        payload: { title: `T${index}` },
        dedupeKey: `k${index}`,
        createdAt: minutesAgo(index + 1),
      })),
    );

    expect(await listNotifications(db, person.id)).toHaveLength(pageSize);
  });
});

function minutesAgoOf(date: Date) {
  return Math.round((Date.now() - date.getTime()) / 60000);
}

describe("counting what is unread", () => {
  it("counts only the unread ones of that person", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await notify(ana.id);
    await notify(ana.id);
    await notify(ana.id, { readAt: new Date() });
    await notify(ben.id);

    expect(await countUnread(db, ana.id)).toBe(2);
    expect(await countUnread(db, ben.id)).toBe(1);
  });
});

describe("markRead", () => {
  it("marks one as read, and the count goes down", async () => {
    const person = await newUser();
    const first = await notify(person.id);
    await notify(person.id);
    const at = new Date("2026-11-03T12:00:00Z");

    expect(await markRead(db, person.id, first.id, at)).toBe(true);

    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, first.id));
    expect(row?.readAt?.toISOString()).toBe(at.toISOString());
    expect(await countUnread(db, person.id)).toBe(1);
  });

  it("keeps the first moment it was read when it is marked again, and says it is there", async () => {
    const person = await newUser();
    const row = await notify(person.id);
    const first = new Date("2026-11-03T12:00:00Z");
    await markRead(db, person.id, row.id, first);

    const again = await markRead(
      db,
      person.id,
      row.id,
      new Date("2026-11-04T12:00:00Z"),
    );

    expect(again).toBe(true);
    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, row.id));
    expect(stored?.readAt?.toISOString()).toBe(first.toISOString());
  });

  it("does not touch a notification of somebody else, and says it was not found", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const his = await notify(ben.id);

    expect(await markRead(db, ana.id, his.id)).toBe(false);

    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, his.id));
    expect(stored?.readAt).toBeNull();
  });

  it("says it was not found for an id that does not exist", async () => {
    const person = await newUser();

    expect(
      await markRead(db, person.id, "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    ).toBe(false);
  });
});

describe("markAllRead", () => {
  it("marks every unread one of the person and nobody else's, and says how many", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await notify(ana.id);
    await notify(ana.id);
    await notify(ana.id, { readAt: minutesAgo(10) });
    await notify(ben.id);

    expect(await markAllRead(db, ana.id)).toBe(2);

    expect(await countUnread(db, ana.id)).toBe(0);
    expect(await countUnread(db, ben.id)).toBe(1);
  });

  it("does not move the moment of the ones that were already read", async () => {
    const person = await newUser();
    const before = minutesAgo(60);
    const read = await notify(person.id, { readAt: before });

    await markAllRead(db, person.id);

    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, read.id));
    expect(stored?.readAt?.toISOString()).toBe(before.toISOString());
  });

  it("is 0 when there is nothing to mark", async () => {
    const person = await newUser();

    expect(await markAllRead(db, person.id)).toBe(0);
  });
});
