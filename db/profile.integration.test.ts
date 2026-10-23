import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { profileUpdateSchema } from "../server/account/profile-schema";
import { getProfile, updateProfile } from "../server/db/profile";
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

/** Runs the form data through the real schema, as the route does. */
const form = (input: Record<string, unknown>) =>
  profileUpdateSchema.parse(input);

describe("getProfile", () => {
  it("returns the profile fields and nothing else", async () => {
    const ana = await newUser({ displayName: "Ana", bio: "Hola" });

    const profile = await getProfile(db, ana.id);

    expect(profile).toEqual({
      username: ana.username,
      displayName: "Ana",
      avatarUrl: null,
      bio: "Hola",
      locale: "es",
      privacy: "public",
    });
    expect(Object.keys(profile ?? {})).not.toContain("role");
    expect(Object.keys(profile ?? {})).not.toContain("clerkId");
    expect(Object.keys(profile ?? {})).not.toContain("emailCanonical");
  });

  it("is null for an id that does not exist and for a deleted account", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect(await getProfile(db, ana.id)).toBeNull();
    expect(
      await getProfile(db, "00000000-0000-7000-8000-000000000000"),
    ).toBeNull();
  });
});

describe("updateProfile", () => {
  it("changes only the fields that were sent", async () => {
    const ana = await newUser({ displayName: "Ana", bio: "Antes" });

    const profile = await updateProfile(
      db,
      ana.id,
      form({ bio: "  Después  ", privacy: "friends" }),
    );

    expect(profile).toMatchObject({
      displayName: "Ana",
      bio: "Después",
      privacy: "friends",
      locale: "es",
    });
  });

  it("clears a field sent empty", async () => {
    const ana = await newUser({ displayName: "Ana", bio: "Antes" });

    const profile = await updateProfile(
      db,
      ana.id,
      form({ displayName: "   ", bio: "" }),
    );

    expect(profile).toMatchObject({ displayName: null, bio: null });
  });

  it("changes the language", async () => {
    const ana = await newUser();

    expect(
      await updateProfile(db, ana.id, form({ locale: "en" })),
    ).toMatchObject({ locale: "en" });
  });

  it("writes nothing and returns the profile when nothing was sent", async () => {
    const ana = await newUser({ displayName: "Ana" });
    const before = (
      await db.select().from(users).where(eq(users.id, ana.id))
    )[0];

    const profile = await updateProfile(db, ana.id, form({}));

    expect(profile).toMatchObject({ displayName: "Ana" });
    const after = (
      await db.select().from(users).where(eq(users.id, ana.id))
    )[0];
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("touches only the row of the given user", async () => {
    const ana = await newUser({ displayName: "Ana" });
    const ben = await newUser({ displayName: "Ben" });

    await updateProfile(db, ana.id, form({ displayName: "Ana María" }));

    expect(await getProfile(db, ben.id)).toMatchObject({ displayName: "Ben" });
  });

  it("never changes the role, the Clerk id, the email or the username", async () => {
    const ana = await newUser();
    const [before] = await db.select().from(users).where(eq(users.id, ana.id));

    await updateProfile(db, ana.id, form({ displayName: "Changed" }));

    const [after] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(after).toMatchObject({
      role: before?.role,
      clerkId: before?.clerkId,
      emailCanonical: before?.emailCanonical,
      username: before?.username,
      deletedAt: null,
    });
  });

  it("refuses at the schema a request that carries a field it must not change", () => {
    for (const field of [
      "role",
      "clerkId",
      "emailCanonical",
      "deletedAt",
      "id",
    ]) {
      expect(() => form({ displayName: "x", [field]: "admin" })).toThrow();
    }
  });

  it("does not change a deleted account, and says so", async () => {
    const ana = await newUser({ displayName: "Ana" });
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ana.id));

    expect(
      await updateProfile(db, ana.id, form({ displayName: "Back" })),
    ).toBeNull();
    const [row] = await db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.displayName).toBe("Ana");
  });

  it("returns null for an id that does not exist", async () => {
    expect(
      await updateProfile(
        db,
        "00000000-0000-7000-8000-000000000000",
        form({ displayName: "Nobody" }),
      ),
    ).toBeNull();
  });

  it("moves updated_at forward when something changes", async () => {
    const ana = await newUser();
    const [before] = await db.select().from(users).where(eq(users.id, ana.id));

    await new Promise((resolve) => setTimeout(resolve, 10));
    await updateProfile(db, ana.id, form({ displayName: "New" }));

    const [after] = await db.select().from(users).where(eq(users.id, ana.id));
    // If either row is missing the comparison fails instead of passing by accident.
    expect(after?.updatedAt.getTime() ?? 0).toBeGreaterThan(
      before?.updatedAt.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });
});
