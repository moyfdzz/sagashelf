import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlExecutor } from "../server/db/clerk-sync";
import { blockUser, muteUser } from "../server/db/blocks-mutes";
import { followUser, unfollowUser } from "../server/db/follows";
import { getSocialCounts, listFollowers } from "../server/db/people-lists";
import { findProfile, findViewableProfile } from "../server/db/profile-lookup";
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

/**
 * Every function of the social graph is ONE statement per question (ADR-031), because on the Neon
 * HTTP client each statement is a subrequest and the only atomic unit. These count them, with the
 * numbers written by hand, so a refactor that splits a statement in two (or asks the database
 * twice for the same thing) fails here and not in production (SAG-118).
 */
function counting() {
  let statements = 0;
  const executor: SqlExecutor = {
    execute: ((query: Parameters<SqlExecutor["execute"]>[0]) => {
      statements += 1;
      return db.execute(query);
    }) as SqlExecutor["execute"],
  };
  return {
    executor,
    get statements() {
      return statements;
    },
  };
}

const person = (username: string) =>
  newUser({ username, emailCanonical: `${username}@example.test` });

describe("the statements of the social graph (SAG-118)", () => {
  it("asks the database twice for a profile, and once for a visitor's relationship", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_owner");

    const signedIn = counting();
    await findProfile(signedIn.executor, ana.id, "ben_owner");
    // The row of the profile, and how the viewer stands to it.
    expect(signedIn.statements).toBe(2);

    const visitor = counting();
    await findProfile(visitor.executor, null, "ben_owner");
    // A visitor is `signed_out` without asking the database for it.
    expect(visitor.statements).toBe(1);

    const viewable = counting();
    await findViewableProfile(viewable.executor, ana.id, "ben_owner");
    expect(viewable.statements).toBe(2);

    const missing = counting();
    await findProfile(missing.executor, ana.id, "nobody_here");
    // A username that does not exist stops at the first.
    expect(missing.statements).toBe(1);
    expect(ben.id).toBeTruthy();
  });

  it("is one statement to follow, unfollow, block and mute", async () => {
    const ana = await person("ana_viewer");
    await person("ben_owner");

    for (const act of [
      (db: SqlExecutor) => followUser(db, ana.id, "ben_owner"),
      (db: SqlExecutor) => unfollowUser(db, ana.id, "ben_owner"),
      (db: SqlExecutor) => muteUser(db, ana.id, "ben_owner"),
      (db: SqlExecutor) => blockUser(db, ana.id, "ben_owner"),
    ]) {
      const run = counting();
      await act(run.executor);
      expect(run.statements).toBe(1);
    }
  });

  it("is one statement for the counts, and the profile plus one for a list of people", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_owner");

    const counts = counting();
    await getSocialCounts(counts.executor, ana.id, ben.id);
    expect(counts.statements).toBe(1);

    const list = counting();
    await listFollowers(list.executor, ana.id, "ben_owner");
    // The profile (2), then the page.
    expect(list.statements).toBe(3);

    const visitorList = counting();
    await listFollowers(visitorList.executor, null, "ben_owner");
    expect(visitorList.statements).toBe(2);
  });
});
