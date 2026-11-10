import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { users } from "../server/db/schema";
import { claimTitleFetch, titleFetchesPerDay } from "../server/db/title-budget";
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

describe("claimTitleFetch", () => {
  it("allows the daily budget and refuses the next one, whatever the address", async () => {
    const ana = await newUser();

    // Written by hand, so a change to the constant has to change this test too.
    expect(titleFetchesPerDay).toBe(300);
    // The claim takes no address: the count is by person only, so a request from another
    // address after the budget is spent gets the same refusal.
    await db
      .update(users)
      .set({
        titleFetchesDay: sql`(now() AT TIME ZONE 'utc')::date`,
        titleFetchesCount: titleFetchesPerDay - 1,
      })
      .where(eq(users.id, ana.id));

    expect(await claimTitleFetch(db, ana.id)).toBe("ok");
    expect((await rowOf(ana.id))?.titleFetchesCount).toBe(titleFetchesPerDay);
    expect(await claimTitleFetch(db, ana.id)).toBe("limit");
    expect(await claimTitleFetch(db, ana.id)).toBe("limit");
    expect((await rowOf(ana.id))?.titleFetchesCount).toBe(titleFetchesPerDay);
  });

  it("does not spend the budget of another person", async () => {
    const ana = await newUser();
    const luis = await newUser();
    await db
      .update(users)
      .set({
        titleFetchesDay: sql`(now() AT TIME ZONE 'utc')::date`,
        titleFetchesCount: titleFetchesPerDay,
      })
      .where(eq(users.id, ana.id));

    expect(await claimTitleFetch(db, ana.id)).toBe("limit");
    expect(await claimTitleFetch(db, luis.id)).toBe("ok");
  });

  it("starts again on another day", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({
        titleFetchesDay: "2026-01-01",
        titleFetchesCount: titleFetchesPerDay,
      })
      .where(eq(users.id, ana.id));

    expect(await claimTitleFetch(db, ana.id)).toBe("ok");
    expect((await rowOf(ana.id))?.titleFetchesCount).toBe(1);
  });

  it("does not let requests sent together pass the limit", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({
        titleFetchesDay: sql`(now() AT TIME ZONE 'utc')::date`,
        titleFetchesCount: titleFetchesPerDay - 3,
      })
      .where(eq(users.id, ana.id));

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => claimTitleFetch(db, ana.id)),
    );

    expect(answers.filter((answer) => answer === "ok")).toHaveLength(3);
    expect(answers.filter((answer) => answer === "limit")).toHaveLength(7);
    expect((await rowOf(ana.id))?.titleFetchesCount).toBe(titleFetchesPerDay);
  });

  it("answers gone for an erased account", async () => {
    const ana = await newUser();
    await db
      .update(users)
      .set({ deletedAt: sql`now()` })
      .where(eq(users.id, ana.id));

    expect(await claimTitleFetch(db, ana.id)).toBe("gone");
    expect(
      await claimTitleFetch(db, "00000000-0000-7000-8000-000000000000"),
    ).toBe("gone");
  });
});
