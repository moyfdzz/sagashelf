import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyUsername,
  claimUsernameChange,
  getUsernameChangedAt,
  isUsernameTaken,
  releaseUsernameChange,
} from "../server/db/username";
import { eraseAccount } from "../server/db/erase-user";
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

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function setChangedAt(id: string, at: Date | null) {
  await db.update(users).set({ usernameChangedAt: at }).where(eq(users.id, id));
}

describe("claimUsernameChange", () => {
  it("lets a person who never changed it take the change, and marks the date", async () => {
    const ana = await newUser();

    const claim = await claimUsernameChange(db, ana.id);

    expect(claim).toEqual({ ok: true, previous: null });
    expect(await getUsernameChangedAt(db, ana.id)).toBeInstanceOf(Date);
  });

  it("refuses a second change inside the 30 days", async () => {
    const ana = await newUser();
    await claimUsernameChange(db, ana.id);

    expect(await claimUsernameChange(db, ana.id)).toEqual({
      ok: false,
      reason: "cooldown",
    });
  });

  it("allows it again after 30 days and refuses it just before", async () => {
    const ana = await newUser();
    await setChangedAt(ana.id, daysAgo(29));
    expect(await claimUsernameChange(db, ana.id)).toMatchObject({
      ok: false,
    });

    const old = daysAgo(31);
    await setChangedAt(ana.id, old);
    const claim = await claimUsernameChange(db, ana.id);

    expect(claim.ok).toBe(true);
    expect(claim.ok && claim.previous?.getTime()).toBe(old.getTime());
  });

  it("lets only one of many requests sent together take the change", async () => {
    const ana = await newUser();

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimUsernameChange(db, ana.id)),
    );

    expect(claims.filter((claim) => claim.ok)).toHaveLength(1);
  });

  it("finds nothing for a deleted account or an id that does not exist", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect(await claimUsernameChange(db, ana.id)).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(
      await claimUsernameChange(db, "00000000-0000-7000-8000-000000000000"),
    ).toEqual({ ok: false, reason: "gone" });
  });
});

describe("releaseUsernameChange", () => {
  it("puts the old date back, so the person can try again", async () => {
    const ana = await newUser();
    const claim = await claimUsernameChange(db, ana.id);
    expect(claim.ok).toBe(true);

    await releaseUsernameChange(db, ana.id, claim.ok ? claim.previous : null);

    expect(await getUsernameChangedAt(db, ana.id)).toBeNull();
    expect((await claimUsernameChange(db, ana.id)).ok).toBe(true);
  });
});

describe("isUsernameTaken", () => {
  it("compares without regard to case, and ignores the person's own row", async () => {
    const ana = await newUser({ username: "Ana_Reads" });
    const bob = await newUser({ username: "bob_reads" });

    expect(await isUsernameTaken(db, bob.id, "ana_reads")).toBe(true);
    expect(await isUsernameTaken(db, ana.id, "ana_reads")).toBe(false);
    expect(await isUsernameTaken(db, ana.id, "free_name")).toBe(false);
  });

  it("counts the name of an account whose row is kept as deleted", async () => {
    const ana = await newUser({ username: "ana_reads" });
    const bob = await newUser({ username: "bob_reads" });
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect(await isUsernameTaken(db, bob.id, "ana_reads")).toBe(true);
  });

  it("frees the name when the account is erased", async () => {
    const ana = await newUser({ username: "ana_reads" });
    const bob = await newUser({ username: "bob_reads" });
    await eraseAccount(db, ana.clerkId);

    expect(await isUsernameTaken(db, bob.id, "ana_reads")).toBe(false);
  });
});

describe("applyUsername", () => {
  it("writes the name with Clerk's time", async () => {
    const ana = await newUser({ username: "ana_reads" });
    const at = new Date(Date.now() + 1000);

    expect(await applyUsername(db, ana.id, "ana_new", at)).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.username).toBe("ana_new");
    expect(row?.clerkUpdatedAt.getTime()).toBe(at.getTime());
  });

  it("does not overwrite a newer event that was already applied", async () => {
    const ana = await newUser({ username: "ana_reads" });
    const newer = new Date(Date.now() + 5000);
    await db
      .update(users)
      .set({ clerkUpdatedAt: newer, username: "ana_latest" })
      .where(eq(users.id, ana.id));

    expect(
      await applyUsername(db, ana.id, "ana_new", new Date(Date.now() + 1000)),
    ).toBe(false);

    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.username).toBe("ana_latest");
  });

  it("refuses a name another account holds (the unique constraint)", async () => {
    const ana = await newUser({ username: "ana_reads" });
    await newUser({ username: "Bob_Reads" });

    await expect(
      applyUsername(db, ana.id, "bob_reads", new Date(Date.now() + 1000)),
    ).rejects.toThrow();
  });

  it("does nothing to a deleted account", async () => {
    const ana = await newUser({ username: "ana_reads" });
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect(
      await applyUsername(db, ana.id, "ana_new", new Date(Date.now() + 1000)),
    ).toBe(false);
  });
});

describe("erasing an account", () => {
  it("clears the date of the last username change", async () => {
    const ana = await newUser();
    await claimUsernameChange(db, ana.id);

    await eraseAccount(db, ana.clerkId);

    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.usernameChangedAt).toBeNull();
  });
});
