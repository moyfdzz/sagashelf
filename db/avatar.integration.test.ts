import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyAvatar,
  avatarUploadsPerDay,
  claimAvatarUpload,
} from "../server/db/avatar";
import { eraseAccount } from "../server/db/erase-user";
import { findHeaderFacts } from "../server/db/header-facts";
import { users } from "../server/db/schema";
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

async function rowOf(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

describe("claimAvatarUpload", () => {
  it("allows five a day and refuses the sixth", async () => {
    const ana = await newUser();

    // Written by hand, so a change to the constant has to change this test too.
    expect(avatarUploadsPerDay).toBe(5);
    for (let count = 1; count <= 5; count += 1) {
      expect(await claimAvatarUpload(db, ana.id)).toBe("ok");
      expect((await rowOf(ana.id))?.avatarUploadsCount).toBe(count);
    }

    expect(await claimAvatarUpload(db, ana.id)).toBe("limit");
    expect((await rowOf(ana.id))?.avatarUploadsCount).toBe(5);
  });

  it("starts again on another day", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({ avatarUploadsDay: "2026-01-01", avatarUploadsCount: 5 })
      .where(eq(users.id, ana.id));

    expect(await claimAvatarUpload(db, ana.id)).toBe("ok");
    expect((await rowOf(ana.id))?.avatarUploadsCount).toBe(1);
  });

  it("does not let requests sent together pass the limit", async () => {
    const ana = await newUser();

    const answers = await Promise.all(
      Array.from({ length: 12 }, () => claimAvatarUpload(db, ana.id)),
    );

    expect(answers.filter((answer) => answer === "ok")).toHaveLength(5);
    expect((await rowOf(ana.id))?.avatarUploadsCount).toBe(5);
  });

  it("counts each person apart", async () => {
    const ana = await newUser();
    const bob = await newUser();
    for (let count = 0; count < 5; count += 1) {
      await claimAvatarUpload(db, ana.id);
    }

    expect(await claimAvatarUpload(db, bob.id)).toBe("ok");
  });

  it("says gone for an erased account and for one that does not exist", async () => {
    const ana = await newUser();
    await eraseAccount(db, ana.clerkId);

    expect(await claimAvatarUpload(db, ana.id)).toBe("gone");
    expect(
      await claimAvatarUpload(db, "00000000-0000-0000-0000-000000000000"),
    ).toBe("gone");
  });
});

describe("applyAvatar", () => {
  const later = new Date(Date.now() + 60_000);

  it("writes the address and Clerk's time", async () => {
    const ana = await newUser();

    expect(
      await applyAvatar(db, ana.id, "https://img.clerk.com/new", true, later),
    ).toBe(true);

    const row = await rowOf(ana.id);
    expect(row?.avatarUrl).toBe("https://img.clerk.com/new");
    expect(row?.clerkUpdatedAt).toEqual(later);
  });

  it("changes nothing when a newer event was already applied", async () => {
    const ana = await newUser();
    await applyAvatar(db, ana.id, "https://img.clerk.com/newer", true, later);

    expect(
      await applyAvatar(
        db,
        ana.id,
        "https://img.clerk.com/older",
        true,
        new Date(later.getTime() - 1000),
      ),
    ).toBe(false);
    expect((await rowOf(ana.id))?.avatarUrl).toBe(
      "https://img.clerk.com/newer",
    );
  });

  it("writes whether it is the person's own picture", async () => {
    const ana = await newUser();

    await applyAvatar(db, ana.id, "https://img.clerk.com/made", false, later);

    expect((await rowOf(ana.id))?.hasOwnPicture).toBe(false);
  });

  it("touches only that person, and never an erased account", async () => {
    const ana = await newUser();
    const bob = await newUser();
    const bobBefore = (await rowOf(bob.id))?.avatarUrl;
    await eraseAccount(db, ana.clerkId);

    expect(
      await applyAvatar(db, ana.id, "https://img.clerk.com/new", true, later),
    ).toBe(false);
    expect((await rowOf(ana.id))?.avatarUrl).toBeNull();
    expect((await rowOf(bob.id))?.avatarUrl).toBe(bobBefore);
  });
});

describe("the picture elsewhere", () => {
  it("is in the one read of the header, only when it is HTTPS", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({ avatarUrl: "https://img.clerk.com/ana" })
      .where(eq(users.id, ana.id));
    expect((await findHeaderFacts(db, ana.clerkId))?.avatarUrl).toBe(
      "https://img.clerk.com/ana",
    );

    await db
      .update(users)
      .set({ avatarUrl: "http://img.clerk.com/ana" })
      .where(eq(users.id, ana.id));
    expect((await findHeaderFacts(db, ana.clerkId))?.avatarUrl).toBeNull();
  });

  it("and the count of the day go with the account", async () => {
    const ana = await newUser();
    await claimAvatarUpload(db, ana.id);
    await applyAvatar(
      db,
      ana.id,
      "https://img.clerk.com/ana",
      true,
      new Date(Date.now() + 60_000),
    );

    await eraseAccount(db, ana.clerkId);

    const row = await rowOf(ana.id);
    expect(row?.avatarUrl).toBeNull();
    expect(row?.avatarUploadsDay).toBeNull();
    expect(row?.avatarUploadsCount).toBe(0);
    expect(row?.hasOwnPicture).toBe(false);
  });
});
