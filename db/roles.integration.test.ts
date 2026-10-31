import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { findRoleByClerkId } from "../server/db/roles";
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

describe("findRoleByClerkId (SAG-95)", () => {
  it("gives the role of the account with that Clerk id, for each role", async () => {
    const user = await newUser({ clerkId: "clerk_user", role: "user" });
    const moderator = await newUser({
      clerkId: "clerk_mod",
      role: "moderator",
    });
    const admin = await newUser({ clerkId: "clerk_admin", role: "admin" });

    expect(await findRoleByClerkId(db, user.clerkId)).toBe("user");
    expect(await findRoleByClerkId(db, moderator.clerkId)).toBe("moderator");
    expect(await findRoleByClerkId(db, admin.clerkId)).toBe("admin");
  });

  it("starts every account as a user, so nobody is an administrator by default", async () => {
    const person = await newUser();

    expect(await findRoleByClerkId(db, person.clerkId)).toBe("user");
  });

  it("is null for an id we do not hold", async () => {
    await newUser({ clerkId: "clerk_known" });

    expect(await findRoleByClerkId(db, "clerk_unknown")).toBeNull();
    expect(await findRoleByClerkId(db, "")).toBeNull();
  });

  it("never takes the role of another account, and ignores the username and the email", async () => {
    await newUser({ clerkId: "clerk_a", role: "admin", username: "someone" });
    const other = await newUser({ clerkId: "clerk_b", role: "user" });

    expect(await findRoleByClerkId(db, other.clerkId)).toBe("user");
    expect(await findRoleByClerkId(db, "someone")).toBeNull();
  });

  it("follows a change of role made by hand in the database", async () => {
    const person = await newUser({ clerkId: "clerk_c" });
    await db.update(users).set({ role: "admin" });

    expect(await findRoleByClerkId(db, person.clerkId)).toBe("admin");
  });
});
