import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  blockUser,
  findViewableProfile,
  followsPerHour,
  followUser,
  getRelationship,
  getSocialCounts,
  listFollowers,
  listFollowing,
  listFriends,
  maxPage,
  muteUser,
  pageSize,
  unblockUser,
  unfollowUser,
  unmuteUser,
} from "../server/db/social";
import { blocks, follows, mutes, users } from "../server/db/schema";
import {
  levels,
  relationships,
  type Level,
  type Relationship,
} from "../server/social/can-view";
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

const person = (username: string, privacy: Level = "public") =>
  newUser({ username, privacy, emailCanonical: `${username}@example.test` });

const follow = (followerId: string, followeeId: string) =>
  db.insert(follows).values({ followerId, followeeId });

const block = (blockerId: string, blockedId: string) =>
  db.insert(blocks).values({ blockerId, blockedId });

const allFollows = () => db.select().from(follows);

describe("followUser (SAG-21)", () => {
  it("follows a person with a public profile", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");

    expect(await followUser(db, ana.id, "ben_public")).toBe("followed");

    expect(await allFollows()).toMatchObject([
      { followerId: ana.id, followeeId: ben.id },
    ]);
  });

  it("finds the person whatever the case of the username", async () => {
    const ana = await person("ana_viewer");
    await person("Ben_Public");

    expect(await followUser(db, ana.id, "ben_PUBLIC")).toBe("followed");
  });

  it("says followed again, and does not add a second row, for someone already followed", async () => {
    const ana = await person("ana_viewer");
    await person("ben_public");

    await followUser(db, ana.id, "ben_public");
    expect(await followUser(db, ana.id, "ben_public")).toBe("followed");

    expect(await allFollows()).toHaveLength(1);
  });

  it("answers the same, and follows nobody, for a friends-only profile, a private one, a missing one and an erased one", async () => {
    const ana = await person("ana_viewer");
    await person("ben_friends", "friends");
    await person("cat_private", "private");
    const gone = await person("dan_erased");
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    const answers = await Promise.all(
      ["ben_friends", "cat_private", "dan_erased", "nobody_here"].map((name) =>
        followUser(db, ana.id, name),
      ),
    );

    expect(answers).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    expect(await allFollows()).toHaveLength(0);
  });

  it("does not let a person follow themselves", async () => {
    const ana = await person("ana_viewer");

    expect(await followUser(db, ana.id, "ana_viewer")).toBe("unavailable");
    expect(await allFollows()).toHaveLength(0);
  });

  it("does not follow someone the person blocked, nor someone who blocked them, and says the same", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    const cat = await person("cat_public");
    await block(ana.id, ben.id);
    await block(cat.id, ana.id);

    expect(await followUser(db, ana.id, "ben_public")).toBe("unavailable");
    expect(await followUser(db, ana.id, "cat_public")).toBe("unavailable");
    expect(await allFollows()).toHaveLength(0);
  });

  it("stops at the hourly cap, and only counts follows made in the last hour", async () => {
    const ana = await person("ana_viewer");
    const others = await Promise.all(
      Array.from({ length: followsPerHour }, (_, i) => person(`other_${i}`)),
    );
    await db.insert(follows).values(
      others.map((other) => ({
        followerId: ana.id,
        followeeId: other.id,
      })),
    );
    await person("one_more");

    expect(await followUser(db, ana.id, "one_more")).toBe("too_many");
    expect(await allFollows()).toHaveLength(followsPerHour);

    // The follows made more than an hour ago no longer count.
    await db
      .update(follows)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(follows.followerId, ana.id));
    expect(await followUser(db, ana.id, "one_more")).toBe("followed");
  });

  it("counts the cap per person, so one person over it does not stop another", async () => {
    const ana = await person("ana_viewer");
    const bob = await person("bob_viewer");
    const others = await Promise.all(
      Array.from({ length: followsPerHour }, (_, i) => person(`other_${i}`)),
    );
    await db
      .insert(follows)
      .values(
        others.map((other) => ({ followerId: ana.id, followeeId: other.id })),
      );
    await person("one_more");

    expect(await followUser(db, ana.id, "one_more")).toBe("too_many");
    expect(await followUser(db, bob.id, "one_more")).toBe("followed");
  });
});

describe("unfollowUser", () => {
  it("removes only the follow of the person who asks", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await follow(ana.id, ben.id);
    await follow(ben.id, ana.id);

    await unfollowUser(db, ana.id, "ben_public");

    expect(await allFollows()).toMatchObject([
      { followerId: ben.id, followeeId: ana.id },
    ]);
  });

  it("does nothing, and says nothing, when there was no follow or no such person", async () => {
    const ana = await person("ana_viewer");
    await person("ben_public");

    await unfollowUser(db, ana.id, "ben_public");
    await unfollowUser(db, ana.id, "nobody_here");

    expect(await allFollows()).toHaveLength(0);
  });
});

describe("blockUser", () => {
  it("records the block and removes the follows in BOTH directions, in one go", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    const cat = await person("cat_public");
    await follow(ana.id, ben.id);
    await follow(ben.id, ana.id);
    await follow(ana.id, cat.id);

    await blockUser(db, ana.id, "ben_public");

    expect(await db.select().from(blocks)).toMatchObject([
      { blockerId: ana.id, blockedId: ben.id },
    ]);
    // Only the follow with a third person is left.
    expect(await allFollows()).toMatchObject([
      { followerId: ana.id, followeeId: cat.id },
    ]);
  });

  it("blocks a person whatever their privacy level, and twice is the same as once", async () => {
    const ana = await person("ana_viewer");
    await person("ben_private", "private");

    await blockUser(db, ana.id, "ben_private");
    await blockUser(db, ana.id, "ben_private");

    expect(await db.select().from(blocks)).toHaveLength(1);
  });

  it("does nothing for oneself, for a missing person or for an erased one", async () => {
    const ana = await person("ana_viewer");
    const gone = await person("dan_erased");
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    await blockUser(db, ana.id, "ana_viewer");
    await blockUser(db, ana.id, "nobody_here");
    await blockUser(db, ana.id, "dan_erased");

    expect(await db.select().from(blocks)).toHaveLength(0);
  });

  it("only touches the follows of the person who blocks", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    const cat = await person("cat_public");
    await follow(ben.id, cat.id);
    await follow(cat.id, ben.id);

    await blockUser(db, ana.id, "ben_public");

    expect(await allFollows()).toHaveLength(2);
  });
});

describe("unblockUser", () => {
  it("removes the block of the person who made it, and does not bring the follows back", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await follow(ana.id, ben.id);
    await blockUser(db, ana.id, "ben_public");

    await unblockUser(db, ana.id, "ben_public");

    expect(await db.select().from(blocks)).toHaveLength(0);
    expect(await allFollows()).toHaveLength(0);
  });

  it("cannot remove a block somebody else made", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await block(ben.id, ana.id);

    await unblockUser(db, ana.id, "ben_public");

    expect(await db.select().from(blocks)).toHaveLength(1);
  });
});

describe("muteUser and unmuteUser", () => {
  it("stores a mute for the person who asks, once, and removes it", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");

    await muteUser(db, ana.id, "ben_public");
    await muteUser(db, ana.id, "ben_public");

    expect(await db.select().from(mutes)).toMatchObject([
      { muterId: ana.id, mutedId: ben.id },
    ]);
    await unmuteUser(db, ana.id, "ben_public");
    expect(await db.select().from(mutes)).toHaveLength(0);
  });

  it("hides nothing and changes no follow, and the other person has no row of their own", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await follow(ana.id, ben.id);

    await muteUser(db, ana.id, "ben_public");

    expect(await allFollows()).toHaveLength(1);
    expect(await getRelationship(db, ana.id, ben.id)).toBe("follower");
    expect(await getRelationship(db, ben.id, ana.id)).toBe("stranger");
    expect(
      await db.select().from(mutes).where(eq(mutes.muterId, ben.id)),
    ).toHaveLength(0);
  });

  it("does nothing for oneself, a missing person or an erased one", async () => {
    const ana = await person("ana_viewer");
    const gone = await person("dan_erased");
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    await muteUser(db, ana.id, "ana_viewer");
    await muteUser(db, ana.id, "nobody_here");
    await muteUser(db, ana.id, "dan_erased");

    expect(await db.select().from(mutes)).toHaveLength(0);
  });

  it("cannot remove a mute somebody else made", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await db.insert(mutes).values({ muterId: ben.id, mutedId: ana.id });

    await unmuteUser(db, ana.id, "ben_public");

    expect(await db.select().from(mutes)).toHaveLength(1);
  });
});

describe("getRelationship", () => {
  it("tells every relationship from the rows of follows and blocks", async () => {
    const owner = await person("owner_one");
    const friend = await person("friend_one");
    const fan = await person("fan_one");
    const stranger = await person("stranger_one");
    const blocked = await person("blocked_one");
    const blocker = await person("blocker_one");
    await follow(friend.id, owner.id);
    await follow(owner.id, friend.id);
    await follow(fan.id, owner.id);
    // Even a pair that follows each other is blocked once one has blocked the other.
    await follow(blocked.id, owner.id);
    await follow(owner.id, blocked.id);
    await block(owner.id, blocked.id);
    await block(blocker.id, owner.id);

    expect(await getRelationship(db, owner.id, owner.id)).toBe("owner");
    expect(await getRelationship(db, friend.id, owner.id)).toBe("friend");
    expect(await getRelationship(db, fan.id, owner.id)).toBe("follower");
    expect(await getRelationship(db, stranger.id, owner.id)).toBe("stranger");
    expect(await getRelationship(db, blocked.id, owner.id)).toBe("blocked");
    expect(await getRelationship(db, blocker.id, owner.id)).toBe("blocked");
    expect(await getRelationship(db, null, owner.id)).toBe("signed_out");
  });

  it("calls someone the owner follows, who does not follow back, a stranger", async () => {
    const owner = await person("owner_one");
    const viewer = await person("viewer_one");
    await follow(owner.id, viewer.id);

    expect(await getRelationship(db, viewer.id, owner.id)).toBe("stranger");
  });
});

/**
 * What each relationship may see of a profile of each level, written out by hand and not asked of
 * `canView`: a test that used the function as its own oracle would pass whatever the function did.
 */
const mayFind: Record<Relationship, Record<Level, boolean>> = {
  owner: { public: true, friends: true, private: true },
  friend: { public: true, friends: true, private: false },
  follower: { public: true, friends: false, private: false },
  stranger: { public: true, friends: false, private: false },
  signed_out: { public: true, friends: false, private: false },
  blocked: { public: false, friends: false, private: false },
};

/**
 * The acceptance criterion of SAG-21: tests of each privacy level × each relationship, against the
 * real database and not only against the policy. For each level there is an owner, and for each
 * relationship a viewer, set up with real rows; whether the profile is found must be what `canView`
 * says.
 */
describe("findViewableProfile: every privacy level × every relationship, on the database", () => {
  async function scene(level: Level) {
    const owner = await person(`owner_${level}`, level);
    const friend = await person(`friend_of_${level}`);
    const fan = await person(`fan_of_${level}`);
    const stranger = await person(`stranger_to_${level}`);
    const blocked = await person(`blocked_by_${level}`);
    await follow(friend.id, owner.id);
    await follow(owner.id, friend.id);
    await follow(fan.id, owner.id);
    await follow(blocked.id, owner.id);
    await follow(owner.id, blocked.id);
    await block(owner.id, blocked.id);
    const viewerOf: Record<Relationship, string | null> = {
      owner: owner.id,
      friend: friend.id,
      follower: fan.id,
      stranger: stranger.id,
      signed_out: null,
      blocked: blocked.id,
    };
    return { owner, viewerOf };
  }

  for (const level of levels) {
    for (const relationship of relationships) {
      it(`${relationship} ${mayFind[relationship][level] ? "finds" : "does not find"} a ${level} profile`, async () => {
        const { owner, viewerOf } = await scene(level);

        const found = await findViewableProfile(
          db,
          viewerOf[relationship],
          owner.username,
        );

        if (mayFind[relationship][level]) {
          expect(found?.owner.id).toBe(owner.id);
          expect(found?.relationship).toBe(relationship);
        } else {
          expect(found).toBeNull();
        }
      });
    }
  }

  it("answers null in the same way for a missing username, an erased one and a profile that may not be seen", async () => {
    const hidden = await person("hidden_one", "private");
    const gone = await person("gone_one");
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));
    const viewer = await person("viewer_one");

    const answers = await Promise.all(
      ["hidden_one", "gone_one", "nobody_here"].map((name) =>
        findViewableProfile(db, viewer.id, name),
      ),
    );

    expect(answers).toEqual([null, null, null]);
    expect(hidden.id).not.toBe(viewer.id);
  });

  it("gives the head of the profile and nothing more", async () => {
    const owner = await newUser({
      username: "head_owner",
      displayName: "Head Owner",
      avatarUrl: "https://img.clerk.com/head",
      bio: "A bio",
      emailCanonical: "head@example.test",
      clerkId: "user_head_secret",
    });

    const found = await findViewableProfile(db, null, "head_owner");

    expect(found?.owner).toEqual({
      id: owner.id,
      username: "head_owner",
      displayName: "Head Owner",
      avatarUrl: "https://img.clerk.com/head",
      bio: "A bio",
      privacy: "public",
    });
    // Never the email, the Clerk id or the role.
    expect(JSON.stringify(found)).not.toContain("head@example.test");
    expect(JSON.stringify(found)).not.toContain("user_head_secret");
  });
});

describe("the lists of followers, following and friends", () => {
  it("lists them newest first, for a public profile, to a visitor too", async () => {
    const owner = await person("owner_one");
    const old = await person("old_fan");
    const recent = await person("recent_fan");
    await db.insert(follows).values([
      {
        followerId: old.id,
        followeeId: owner.id,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        followerId: recent.id,
        followeeId: owner.id,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    const page = await listFollowers(db, null, "owner_one");

    expect(page?.people.map((p) => p.username)).toEqual([
      "recent_fan",
      "old_fan",
    ]);
    expect(page?.hasMore).toBe(false);
  });

  it("lists whom a person follows, and their friends (mutual follows only)", async () => {
    const owner = await person("owner_one");
    const friend = await person("mutual_one");
    const oneWay = await person("one_way");
    await follow(owner.id, friend.id);
    await follow(friend.id, owner.id);
    await follow(owner.id, oneWay.id);

    const following = await listFollowing(db, null, "owner_one");
    const friends = await listFriends(db, null, "owner_one");

    expect(following?.people.map((p) => p.username).sort()).toEqual([
      "mutual_one",
      "one_way",
    ]);
    expect(friends?.people.map((p) => p.username)).toEqual(["mutual_one"]);
  });

  it("shows only username, name and picture of each person", async () => {
    const owner = await person("owner_one");
    const fan = await newUser({
      username: "fan_one",
      displayName: "Fan",
      avatarUrl: "https://img.clerk.com/fan",
      bio: "secret bio",
      emailCanonical: "fan@example.test",
    });
    await follow(fan.id, owner.id);

    const page = await listFollowers(db, null, "owner_one");

    expect(page?.people).toEqual([
      {
        username: "fan_one",
        displayName: "Fan",
        avatarUrl: "https://img.clerk.com/fan",
      },
    ]);
  });

  it("is null, like a missing profile, when the viewer may not see the profile", async () => {
    const owner = await person("owner_private", "private");
    const fan = await person("fan_one");
    const viewer = await person("viewer_one");
    await follow(fan.id, owner.id);

    expect(await listFollowers(db, viewer.id, "owner_private")).toBeNull();
    expect(await listFollowers(db, null, "owner_private")).toBeNull();
    expect(await listFollowing(db, viewer.id, "owner_private")).toBeNull();
    expect(await listFriends(db, viewer.id, "owner_private")).toBeNull();
    expect(await listFollowers(db, viewer.id, "nobody_here")).toBeNull();
    // The owner sees their own list.
    expect(
      (await listFollowers(db, owner.id, "owner_private"))?.people,
    ).toHaveLength(1);
  });

  it("gives a friends-only profile's lists to its friends and its owner, and to nobody else", async () => {
    const owner = await person("owner_friends", "friends");
    const friend = await person("friend_one");
    const fan = await person("fan_one");
    await follow(friend.id, owner.id);
    await follow(owner.id, friend.id);
    await follow(fan.id, owner.id);

    expect(await listFollowers(db, friend.id, "owner_friends")).not.toBeNull();
    expect(await listFollowers(db, owner.id, "owner_friends")).not.toBeNull();
    expect(await listFollowers(db, fan.id, "owner_friends")).toBeNull();
    expect(await listFollowers(db, null, "owner_friends")).toBeNull();
  });

  it("follows the privacy of each person on the list: a private or friends-only follower is hidden from those who may not see them", async () => {
    const owner = await person("owner_one");
    const pub = await person("fan_public");
    const friendsOnly = await person("fan_friends", "friends");
    const hidden = await person("fan_private", "private");
    const viewerFriend = await person("viewer_friend");
    const stranger = await person("stranger_one");
    for (const fan of [pub, friendsOnly, hidden])
      await follow(fan.id, owner.id);
    // The viewer is a friend of the friends-only follower, and of nobody else.
    await follow(viewerFriend.id, friendsOnly.id);
    await follow(friendsOnly.id, viewerFriend.id);

    const names = async (viewerId: string | null) =>
      (await listFollowers(db, viewerId, "owner_one"))?.people
        .map((p) => p.username)
        .sort();

    expect(await names(null)).toEqual(["fan_public"]);
    expect(await names(stranger.id)).toEqual(["fan_public"]);
    expect(await names(viewerFriend.id)).toEqual(["fan_friends", "fan_public"]);
    // The owner of the list sees everybody who follows them.
    expect(await names(owner.id)).toEqual([
      "fan_friends",
      "fan_private",
      "fan_public",
    ]);
    // A person always sees themselves on a list.
    expect(await names(hidden.id)).toEqual(["fan_private", "fan_public"]);
  });

  it("leaves out erased accounts and anybody blocked either way with the viewer", async () => {
    const owner = await person("owner_one");
    const viewer = await person("viewer_one");
    const gone = await person("gone_fan");
    const blockedByViewer = await person("blocked_by_viewer");
    const blockerOfViewer = await person("blocker_of_viewer");
    const normal = await person("normal_fan");
    for (const fan of [gone, blockedByViewer, blockerOfViewer, normal]) {
      await follow(fan.id, owner.id);
    }
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));
    await block(viewer.id, blockedByViewer.id);
    await block(blockerOfViewer.id, viewer.id);

    const page = await listFollowers(db, viewer.id, "owner_one");

    expect(page?.people.map((p) => p.username)).toEqual(["normal_fan"]);
  });

  it("pages, with hasMore, and never goes beyond the last page that can be asked for", async () => {
    const owner = await person("owner_one");
    const fans = await Promise.all(
      Array.from({ length: pageSize + 3 }, (_, i) => person(`fan_${i}`)),
    );
    await db.insert(follows).values(
      fans.map((fan, i) => ({
        followerId: fan.id,
        followeeId: owner.id,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      })),
    );

    const first = await listFollowers(db, null, "owner_one", 1);
    const second = await listFollowers(db, null, "owner_one", 2);
    const huge = await listFollowers(db, null, "owner_one", maxPage + 500);
    const nonsense = await listFollowers(db, null, "owner_one", Number.NaN);

    expect(first?.people).toHaveLength(pageSize);
    expect(first?.hasMore).toBe(true);
    expect(second?.people).toHaveLength(3);
    expect(second?.hasMore).toBe(false);
    expect(huge?.people).toHaveLength(0);
    expect(nonsense?.people).toHaveLength(pageSize);
  });
});

describe("getSocialCounts", () => {
  it("counts followers, following and friends, without erased accounts", async () => {
    const owner = await person("owner_one");
    const friend = await person("friend_one");
    const fan = await person("fan_one");
    const gone = await person("gone_one");
    await follow(owner.id, friend.id);
    await follow(friend.id, owner.id);
    await follow(fan.id, owner.id);
    await follow(gone.id, owner.id);
    await follow(owner.id, gone.id);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    expect(await getSocialCounts(db, owner.id)).toEqual({
      followers: 2,
      following: 1,
      friends: 1,
    });
  });

  it("is zero for a person with no follows", async () => {
    const owner = await person("owner_one");

    expect(await getSocialCounts(db, owner.id)).toEqual({
      followers: 0,
      following: 0,
      friends: 0,
    });
  });
});

describe("the rows themselves", () => {
  it("refuses a mute of oneself and a mute of a person who does not exist", async () => {
    const ana = await person("ana_viewer");

    await expect(
      db.insert(mutes).values({ muterId: ana.id, mutedId: ana.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(mutes).values({
        muterId: ana.id,
        mutedId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
      }),
    ).rejects.toThrow();
  });

  it("deletes the mutes of a person with them, in both directions", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_public");
    await db.insert(mutes).values([
      { muterId: ana.id, mutedId: ben.id },
      { muterId: ben.id, mutedId: ana.id },
    ]);

    await db.delete(users).where(eq(users.id, ana.id));

    expect(
      await db
        .select()
        .from(mutes)
        .where(and(eq(mutes.muterId, ben.id))),
    ).toHaveLength(0);
  });
});
