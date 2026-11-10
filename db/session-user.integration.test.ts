import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { users } from "../server/db/schema";
import { findSessionUser } from "../server/db/session-user";
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

describe("findSessionUser", () => {
  it("finds an active account by the Clerk id of the session", async () => {
    const ana = await newUser({ clerkId: "user_ana", role: "moderator" });

    expect(await findSessionUser(db, "user_ana")).toEqual({
      id: ana.id,
      clerkId: "user_ana",
      role: "moderator",
    });
  });

  it("marks a suspended or banned account as restricted", async () => {
    await newUser({ clerkId: "user_sus", moderationStatus: "suspended" });
    await newUser({ clerkId: "user_ban", moderationStatus: "banned" });

    expect((await findSessionUser(db, "user_sus"))?.restricted).toBe(true);
    expect((await findSessionUser(db, "user_ban"))?.restricted).toBe(true);
  });

  it("is null for an account that does not exist", async () => {
    expect(await findSessionUser(db, "user_nobody")).toBeNull();
  });

  it("is null for an erased account, which keeps its row and its Clerk id (SAG-166)", async () => {
    const gone = await newUser({ clerkId: "user_gone", role: "admin" });
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    expect(await findSessionUser(db, "user_gone")).toBeNull();
  });
});
