import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { findHeaderFacts } from "../server/db/header-facts";
import { unreadCap } from "../server/db/notifications";
import { followRequests, notifications, users } from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

let counter = 0;
const notify = (userId: string, readAt: Date | null = null) => {
  counter += 1;
  return db.insert(notifications).values({
    userId,
    type: "episode.aired",
    payload: { title: `T${counter}` },
    dedupeKey: `k${counter}`,
    readAt,
  });
};

describe("findHeaderFacts (SAG-114): the three facts of the header in one read", () => {
  it("gives the username, the role as a yes or no, and the count of unread notifications", async () => {
    const ana = await newUser({
      clerkId: "user_ana",
      username: "ana_reads",
      role: "admin",
    });
    await notify(ana.id);
    await notify(ana.id);
    await notify(ana.id, new Date());

    expect(await findHeaderFacts(db, "user_ana")).toEqual({
      isAdmin: true,
      username: "ana_reads",
      avatarUrl: null,
      unread: 2,
    });
  });

  it.each(["user", "moderator"] as const)(
    "says a %s is not an administrator",
    async (role) => {
      await newUser({ clerkId: "user_x", role });

      expect((await findHeaderFacts(db, "user_x"))?.isAdmin).toBe(false);
    },
  );

  it("counts only the notifications of that person", async () => {
    const ana = await newUser({ clerkId: "user_ana" });
    const ben = await newUser({ clerkId: "user_ben" });
    await notify(ana.id);
    await notify(ben.id);
    await notify(ben.id);

    expect((await findHeaderFacts(db, "user_ana"))?.unread).toBe(1);
    expect((await findHeaderFacts(db, "user_ben"))?.unread).toBe(2);
  });

  it("is zero for a person with no notifications", async () => {
    await newUser({ clerkId: "user_ana" });

    expect((await findHeaderFacts(db, "user_ana"))?.unread).toBe(0);
  });

  it("stops counting a little after the cap, so the header can say 99+", async () => {
    const ana = await newUser({ clerkId: "user_many" });
    await db.insert(notifications).values(
      Array.from({ length: unreadCap + 20 }, (_, index) => ({
        userId: ana.id,
        type: "episode.aired",
        payload: { title: `T${index}` },
        dedupeKey: `many${index}`,
      })),
    );

    expect((await findHeaderFacts(db, "user_many"))?.unread).toBe(
      unreadCap + 1,
    );
  });

  it("adds the follow requests waiting for an answer to the count, and not the declined ones or the ones sent", async () => {
    const ana = await newUser({ clerkId: "user_ana" });
    const ben = await newUser({ clerkId: "user_ben" });
    const cat = await newUser({ clerkId: "user_cat" });
    const dan = await newUser({ clerkId: "user_dan" });
    await notify(ana.id);
    await db.insert(followRequests).values([
      { requesterId: ben.id, targetId: ana.id },
      { requesterId: cat.id, targetId: ana.id, declinedAt: new Date() },
      { requesterId: ana.id, targetId: dan.id },
    ]);

    // One notification and one request waiting: the declined one and the one she sent do not count
    // for her. The one she sent is waiting for Dan, and the declined one is nobody's.
    expect((await findHeaderFacts(db, "user_ana"))?.unread).toBe(2);
    expect((await findHeaderFacts(db, "user_dan"))?.unread).toBe(1);
    expect((await findHeaderFacts(db, "user_ben"))?.unread).toBe(0);
  });

  it("stops counting the requests a little after the cap too", async () => {
    const ana = await newUser({ clerkId: "user_popular" });
    for (let index = 0; index < unreadCap + 5; index += 1) {
      const other = await newUser();
      await db
        .insert(followRequests)
        .values({ requesterId: other.id, targetId: ana.id });
    }

    expect((await findHeaderFacts(db, "user_popular"))?.unread).toBe(
      unreadCap + 1,
    );
  });

  it("is null for an account that does not exist, and for an empty id", async () => {
    expect(await findHeaderFacts(db, "user_nobody")).toBeNull();
    expect(await findHeaderFacts(db, "")).toBeNull();
  });

  it("is null for an erased account, which keeps its row but has no header", async () => {
    const ana = await newUser({ clerkId: "user_gone", role: "admin" });
    await notify(ana.id);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect(await findHeaderFacts(db, "user_gone")).toBeNull();
  });

  it("gives the username as it is written, whatever its case", async () => {
    await newUser({ clerkId: "user_case", username: "Mixed_Case" });

    expect((await findHeaderFacts(db, "user_case"))?.username).toBe(
      "Mixed_Case",
    );
  });
});
