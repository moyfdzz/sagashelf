import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  hasRequested,
  listPendingRequests,
  requestFollow,
  sentRequestsMax,
} from "../server/db/follow-requests";
import {
  blockUser,
  followsPerHour,
  followUser,
  getRelationship,
} from "../server/db/social";
import { blocks, followRequests, follows, users } from "../server/db/schema";
import type { Level } from "../server/social/can-view";
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

const person = (username: string, privacy: Level = "public") =>
  newUser({ username, privacy, emailCanonical: `${username}@example.test` });

const follow = (followerId: string, followeeId: string) =>
  db.insert(follows).values({ followerId, followeeId });

const block = (blockerId: string, blockedId: string) =>
  db.insert(blocks).values({ blockerId, blockedId });

const ask = (requesterId: string, targetId: string, declined = false) =>
  db.insert(followRequests).values({
    requesterId,
    targetId,
    declinedAt: declined ? new Date() : null,
  });

const allRequests = () => db.select().from(followRequests);
const allFollows = () => db.select().from(follows);

/** Pairs as "requester>target", sorted, so a test states the whole table in one line. */
const pairs = async () => {
  const names = new Map(
    (await db.select().from(users)).map((user) => [user.id, user.username]),
  );
  return (await allRequests())
    .map((row) => `${names.get(row.requesterId)}>${names.get(row.targetId)}`)
    .sort();
};

const followPairs = async () => {
  const names = new Map(
    (await db.select().from(users)).map((user) => [user.id, user.username]),
  );
  return (await allFollows())
    .map((row) => `${names.get(row.followerId)}>${names.get(row.followeeId)}`)
    .sort();
};

describe("requestFollow (SAG-108)", () => {
  it("asks a Private profile (level friends) to be followed", async () => {
    const ana = await person("ana_viewer");
    await person("ben_private", "friends");

    expect(await requestFollow(db, ana.id, "ben_private")).toBe("requested");

    expect(await pairs()).toEqual(["ana_viewer>ben_private"]);
    expect(await allFollows()).toHaveLength(0);
  });

  it("allows only the Private level: a public profile is followed, a hidden one is not there", async () => {
    // The whole table, written by hand: what each level of the target answers.
    const expected: Record<Level, string> = {
      public: "unavailable",
      friends: "requested",
      private: "unavailable",
    };
    const ana = await person("ana_viewer");
    for (const level of Object.keys(expected) as Level[]) {
      await person(`target_${level}`, level);
    }

    for (const level of Object.keys(expected) as Level[]) {
      expect(await requestFollow(db, ana.id, `target_${level}`), level).toBe(
        expected[level],
      );
    }
    expect(await pairs()).toEqual(["ana_viewer>target_friends"]);
  });

  it("answers the same, and writes nothing, for a hidden profile, a missing one, an erased one, oneself and a person already followed", async () => {
    const ana = await person("ana_viewer", "friends");
    await person("cat_hidden", "private");
    const gone = await person("dan_erased", "friends");
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));
    const eve = await person("eve_followed", "friends");
    await follow(ana.id, eve.id);

    const answers = await Promise.all(
      [
        "cat_hidden",
        "dan_erased",
        "nobody_here",
        "ana_viewer",
        "eve_followed",
      ].map((name) => requestFollow(db, ana.id, name)),
    );

    expect(answers).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    expect(await allRequests()).toHaveLength(0);
  });

  it("does not ask somebody the person blocked, nor somebody who blocked them, and says the same", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    const cat = await person("cat_private", "friends");
    await block(ana.id, ben.id);
    await block(cat.id, ana.id);

    expect(await requestFollow(db, ana.id, "ben_private")).toBe("unavailable");
    expect(await requestFollow(db, ana.id, "cat_private")).toBe("unavailable");
    expect(await allRequests()).toHaveLength(0);
  });

  it("finds the person whatever the case of the username", async () => {
    const ana = await person("ana_viewer");
    await person("Ben_Private", "friends");

    expect(await requestFollow(db, ana.id, "ben_PRIVATE")).toBe("requested");
  });

  it("says requested again, and changes nothing, for a request that is already pending", async () => {
    const ana = await person("ana_viewer");
    await person("ben_private", "friends");
    await requestFollow(db, ana.id, "ben_private");
    const [first] = await allRequests();

    expect(await requestFollow(db, ana.id, "ben_private")).toBe("requested");

    const rows = await allRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toEqual(first?.createdAt);
  });

  it("keeps a declined request as it is, and answers as if it was sent, until it is cancelled", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);
    await declineRequest(db, ben.id, "ana_viewer");
    const [declined] = await allRequests();
    expect(declined?.declinedAt).toBeInstanceOf(Date);

    // The same answer as a request that went through, and the row is not renewed.
    expect(await requestFollow(db, ana.id, "ben_private")).toBe("requested");

    const [after] = await allRequests();
    expect(after?.declinedAt).toEqual(declined?.declinedAt);
    expect(after?.createdAt).toEqual(declined?.createdAt);
    expect(await listPendingRequests(db, ben.id)).toHaveLength(0);
  });

  it("lets a declined request be sent again at once after the requester cancelled it", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);
    await declineRequest(db, ben.id, "ana_viewer");
    await cancelRequest(db, ana.id, "ben_private");

    expect(await requestFollow(db, ana.id, "ben_private")).toBe("requested");

    const [row] = await allRequests();
    expect(row?.declinedAt).toBeNull();
    expect(
      (await listPendingRequests(db, ben.id)).map((r) => r.username),
    ).toEqual(["ana_viewer"]);
  });

  it("shares the hourly cap with the follows: follows plus requests of the last hour", async () => {
    const ana = await person("ana_viewer");
    const half = followsPerHour / 2;
    for (let index = 0; index < half; index += 1) {
      const other = await person(`pub_${index}`);
      await follow(ana.id, other.id);
      const closed = await person(`closed_${index}`, "friends");
      await ask(ana.id, closed.id);
    }
    await person("next_private", "friends");
    await person("next_public");

    expect(await requestFollow(db, ana.id, "next_private")).toBe("too_many");
    expect(await followUser(db, ana.id, "next_public")).toBe("too_many");
    expect(await pairs()).not.toContain("ana_viewer>next_private");
  });

  it("does not count what is older than an hour, but stops at the number of requests sent", async () => {
    const ana = await person("ana_viewer");
    for (let index = 0; index < sentRequestsMax; index += 1) {
      const closed = await person(`closed_${index}`, "friends");
      await ask(ana.id, closed.id);
    }
    await db.execute(
      sql`UPDATE follow_requests SET created_at = now() - interval '2 hours'`,
    );
    await person("next_private", "friends");

    // The hour is clear, but 100 requests are out already.
    expect(await requestFollow(db, ana.id, "next_private")).toBe("too_many");
    // A person who already has a request out is not refused for it: asking again is not a new one.
    expect(await requestFollow(db, ana.id, "closed_0")).toBe("requested");
    expect(await allRequests()).toHaveLength(sentRequestsMax);
  });
});

describe("cancelRequest and hasRequested (SAG-108)", () => {
  it("takes back a pending request, and only the one of that pair", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    const cat = await person("cat_private", "friends");
    const dan = await person("dan_viewer");
    await ask(ana.id, ben.id);
    await ask(ana.id, cat.id);
    await ask(dan.id, ben.id);

    await cancelRequest(db, ana.id, "ben_private");

    expect(await pairs()).toEqual([
      "ana_viewer>cat_private",
      "dan_viewer>ben_private",
    ]);
  });

  it("takes back a declined request too, so the person can ask again", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id, true);
    expect(await hasRequested(db, ana.id, ben.id)).toBe(true);

    await cancelRequest(db, ana.id, "ben_private");

    expect(await pairs()).toEqual([]);
    expect(await hasRequested(db, ana.id, ben.id)).toBe(false);
  });

  it("does nothing, quietly, for a name that does not exist or without a request", async () => {
    const ana = await person("ana_viewer");
    await person("ben_private", "friends");

    await expect(cancelRequest(db, ana.id, "nobody_here")).resolves.toBe(
      undefined,
    );
    await expect(cancelRequest(db, ana.id, "ben_private")).resolves.toBe(
      undefined,
    );
  });

  it("does not let the target cancel what somebody asked them", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);

    await cancelRequest(db, ben.id, "ana_viewer");

    expect(await pairs()).toEqual(["ana_viewer>ben_private"]);
  });

  it("tells whether a request was sent, pending or declined, and only in that direction", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    const cat = await person("cat_private", "friends");
    const dan = await person("dan_private", "friends");
    await ask(ana.id, ben.id);
    await ask(ana.id, cat.id, true);

    expect(await hasRequested(db, ana.id, ben.id)).toBe(true);
    expect(await hasRequested(db, ana.id, cat.id)).toBe(true);
    expect(await hasRequested(db, ana.id, dan.id)).toBe(false);
    expect(await hasRequested(db, ben.id, ana.id)).toBe(false);
  });
});

describe("listPendingRequests (SAG-108)", () => {
  it("lists the requests waiting for the owner, newest first, with whether they can be followed back", async () => {
    const owner = await person("owner_private", "friends");
    const ana = await person("ana_public", "public");
    const ben = await person("ben_private", "friends");
    const cat = await person("cat_hidden", "private");
    await ask(ana.id, owner.id);
    await ask(ben.id, owner.id);
    await ask(cat.id, owner.id);
    await db.execute(sql`
      UPDATE follow_requests SET created_at = CASE requester_id
        WHEN ${ana.id}::uuid THEN now() - interval '3 minutes'
        WHEN ${ben.id}::uuid THEN now() - interval '1 minute'
        ELSE now() - interval '2 minutes' END
    `);

    const list = await listPendingRequests(db, owner.id);

    expect(list.map((r) => [r.username, r.canFollowBack])).toEqual([
      ["ben_private", true],
      ["cat_hidden", false],
      ["ana_public", true],
    ]);
  });

  it("leaves out the declined, the erased and the blocked in either direction", async () => {
    const owner = await person("owner_private", "friends");
    const declined = await person("dan_declined");
    const erased = await person("eve_erased");
    const blockedByOwner = await person("fay_blocked");
    const blockedOwner = await person("gus_blocker");
    const fine = await person("hal_fine");
    for (const who of [declined, erased, blockedByOwner, blockedOwner, fine]) {
      await ask(who.id, owner.id, who.id === declined.id);
    }
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, erased.id));
    await block(owner.id, blockedByOwner.id);
    await block(blockedOwner.id, owner.id);

    expect(
      (await listPendingRequests(db, owner.id)).map((r) => r.username),
    ).toEqual(["hal_fine"]);
  });

  it("lists only what was asked of that person, not what they asked", async () => {
    const ana = await person("ana_private", "friends");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);

    expect(await listPendingRequests(db, ana.id)).toHaveLength(0);
    expect(await listPendingRequests(db, ben.id)).toHaveLength(1);
  });
});

describe("acceptRequest (SAG-108)", () => {
  it("makes the requester a follower, and nothing else, with a plain accept", async () => {
    const owner = await person("owner_private", "friends");
    const ana = await person("ana_public");
    await ask(ana.id, owner.id);

    expect(await acceptRequest(db, owner.id, "ana_public", false)).toBe(true);

    expect(await followPairs()).toEqual(["ana_public>owner_private"]);
    expect(await allRequests()).toHaveLength(0);
    expect(await getRelationship(db, ana.id, owner.id)).toBe("follower");
  });

  it("follows a Public requester back, so they become friends", async () => {
    const owner = await person("owner_private", "friends");
    const ana = await person("ana_public");
    await ask(ana.id, owner.id);

    expect(await acceptRequest(db, owner.id, "ana_public", true)).toBe(true);

    expect(await followPairs()).toEqual([
      "ana_public>owner_private",
      "owner_private>ana_public",
    ]);
    expect(await allRequests()).toHaveLength(0);
    expect(await getRelationship(db, ana.id, owner.id)).toBe("friend");
  });

  it("sends a request back, and does not follow, when the requester is Private", async () => {
    const owner = await person("owner_private", "friends");
    const ben = await person("ben_private", "friends");
    await ask(ben.id, owner.id);

    expect(await acceptRequest(db, owner.id, "ben_private", true)).toBe(true);

    // Ben follows the owner; the owner only asked, and Ben has to accept.
    expect(await followPairs()).toEqual(["ben_private>owner_private"]);
    expect(await pairs()).toEqual(["owner_private>ben_private"]);
    expect(await getRelationship(db, ben.id, owner.id)).toBe("follower");
  });

  it("does not send the request back when the owner already follows the requester", async () => {
    const owner = await person("owner_private", "friends");
    const ben = await person("ben_private", "friends");
    await follow(owner.id, ben.id);
    await ask(ben.id, owner.id);

    await acceptRequest(db, owner.id, "ben_private", true);

    expect(await allRequests()).toHaveLength(0);
    expect(await getRelationship(db, ben.id, owner.id)).toBe("friend");
  });

  it("only accepts a hidden requester: there is nothing to follow back", async () => {
    const owner = await person("owner_private", "friends");
    const cat = await person("cat_hidden", "private");
    await ask(cat.id, owner.id);

    expect(await acceptRequest(db, owner.id, "cat_hidden", true)).toBe(true);

    expect(await followPairs()).toEqual(["cat_hidden>owner_private"]);
    expect(await allRequests()).toHaveLength(0);
  });

  it("leaves a request the owner sent to the requester as it was, when both asked each other", async () => {
    const owner = await person("owner_private", "friends");
    const ben = await person("ben_private", "friends");
    await ask(ben.id, owner.id);
    await ask(owner.id, ben.id);
    const before = (await allRequests()).find(
      (r) => r.requesterId === owner.id,
    );

    await acceptRequest(db, owner.id, "ben_private", true);

    const after = await allRequests();
    expect(after).toHaveLength(1);
    expect(after[0]?.createdAt).toEqual(before?.createdAt);
    expect(await followPairs()).toEqual(["ben_private>owner_private"]);
  });

  it("answers false, and changes nothing, without a pending request", async () => {
    const owner = await person("owner_private", "friends");
    const ana = await person("ana_public");
    const dan = await person("dan_declined");
    await ask(dan.id, owner.id, true);

    expect(await acceptRequest(db, owner.id, "ana_public", true)).toBe(false);
    expect(await acceptRequest(db, owner.id, "dan_declined", true)).toBe(false);
    expect(await acceptRequest(db, owner.id, "nobody_here", true)).toBe(false);

    expect(await allFollows()).toHaveLength(0);
    expect(await pairs()).toEqual(["dan_declined>owner_private"]);
    expect(ana.id).not.toBe(owner.id);
  });

  it("accepts only what was asked of the person of the session, never a request to somebody else", async () => {
    const owner = await person("owner_private", "friends");
    const other = await person("other_private", "friends");
    const ana = await person("ana_public");
    await ask(ana.id, other.id);

    expect(await acceptRequest(db, owner.id, "ana_public", true)).toBe(false);

    expect(await allFollows()).toHaveLength(0);
    expect(await pairs()).toEqual(["ana_public>other_private"]);
  });

  it("does not accept a request from an erased account or from somebody blocked", async () => {
    const owner = await person("owner_private", "friends");
    const erased = await person("eve_erased");
    const blocked = await person("fay_blocked");
    const blocker = await person("gus_blocker");
    for (const who of [erased, blocked, blocker]) await ask(who.id, owner.id);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, erased.id));
    await block(owner.id, blocked.id);
    await block(blocker.id, owner.id);

    for (const name of ["eve_erased", "fay_blocked", "gus_blocker"]) {
      expect(await acceptRequest(db, owner.id, name, true), name).toBe(false);
    }
    expect(await allFollows()).toHaveLength(0);
  });
});

describe("declineRequest (SAG-108)", () => {
  it("hides the request from the owner and keeps it looking sent for the requester", async () => {
    const owner = await person("owner_private", "friends");
    const ana = await person("ana_public");
    await ask(ana.id, owner.id);

    expect(await declineRequest(db, owner.id, "ana_public")).toBe(true);

    expect(await listPendingRequests(db, owner.id)).toHaveLength(0);
    expect(await hasRequested(db, ana.id, owner.id)).toBe(true);
    expect(await allFollows()).toHaveLength(0);
    expect(await getRelationship(db, ana.id, owner.id)).toBe("stranger");
  });

  it("does nothing the second time, for a missing name and for somebody else's request", async () => {
    const owner = await person("owner_private", "friends");
    const other = await person("other_private", "friends");
    const ana = await person("ana_public");
    await ask(ana.id, owner.id);
    await ask(ana.id, other.id);
    await declineRequest(db, owner.id, "ana_public");

    expect(await declineRequest(db, owner.id, "ana_public")).toBe(false);
    expect(await declineRequest(db, owner.id, "nobody_here")).toBe(false);

    // The request to the other person is still pending: only the owner's own was declined.
    const pending = await db
      .select()
      .from(followRequests)
      .where(
        and(
          eq(followRequests.targetId, other.id),
          sql`${followRequests.declinedAt} IS NULL`,
        ),
      );
    expect(pending).toHaveLength(1);
  });

  it("cannot be used by the requester to decline their own request", async () => {
    const owner = await person("owner_private", "friends");
    const ana = await person("ana_public");
    await ask(ana.id, owner.id);

    expect(await declineRequest(db, ana.id, "owner_private")).toBe(false);
    expect(await listPendingRequests(db, owner.id)).toHaveLength(1);
  });
});

describe("blocks and follows meet the requests (SAG-108)", () => {
  it("removes the requests between two people, in both directions and declined ones too, when one blocks the other", async () => {
    const ana = await person("ana_private", "friends");
    const ben = await person("ben_private", "friends");
    const cat = await person("cat_private", "friends");
    await ask(ana.id, ben.id);
    await ask(ben.id, ana.id, true);
    await ask(ana.id, cat.id);
    await ask(cat.id, ben.id);

    await blockUser(db, ana.id, "ben_private");

    expect(await pairs()).toEqual([
      "ana_private>cat_private",
      "cat_private>ben_private",
    ]);
  });

  it("removes a request in the other direction too, when the one who asked is the one who blocks", async () => {
    const ana = await person("ana_private", "friends");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);

    await blockUser(db, ben.id, "ana_private");

    expect(await allRequests()).toHaveLength(0);
  });

  it("drops a pending request when the person can follow the profile directly", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await ask(ana.id, ben.id);

    expect(await followUser(db, ana.id, "ben_public")).toBe("followed");

    expect(await allRequests()).toHaveLength(0);
    expect(await followPairs()).toEqual(["ana_viewer>ben_public"]);
  });
});

describe("the table follow_requests (SAG-108)", () => {
  it("refuses a request to oneself", async () => {
    const ana = await person("ana_private", "friends");

    expect(await failsWith(ask(ana.id, ana.id))).toMatchObject({
      code: "23514",
      constraint: "follow_requests_not_self_check",
    });
  });

  it("holds one row per pair of people", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);

    expect((await failsWith(ask(ana.id, ben.id))).code).toBe("23505");
  });

  it("goes with either person when their account row is deleted", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_private", "friends");
    await ask(ana.id, ben.id);
    await ask(ben.id, ana.id);

    await db.delete(users).where(eq(users.id, ana.id));

    expect(await allRequests()).toHaveLength(0);
  });
});
