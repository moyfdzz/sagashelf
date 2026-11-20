import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readFeed, setLike } from "../server/db/feed";
import { readReviews } from "../server/db/reviews";
import type { Level } from "../server/social/can-view";
import { createTestDb } from "./test-database";
import { reviewFixtures, type Person } from "./review-fixtures";

// SAG-22, ADR-053 and ADR-056: who sees a review, its likes and its feed event, against the real Postgres.
// The expected tables are written by hand from the ADRs.

const { db, pool } = createTestDb();
const {
  newMedia,
  reset,
  person,
  follow,
  entryOf,
  titleOf,
  review,
  authorsSeenBy,
  count,
} = reviewFixtures(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(reset);

describe("who sees a review on the title page", () => {
  type Viewer = "visitor" | "stranger" | "follower" | "friend";

  // The review's own level and the profile's, written by hand from ADR-053: the entry does not
  // matter, a locked profile (friends) still shows its public reviews, and Total privacy hides all.
  it.each<[Level, Level, Viewer[]]>([
    ["public", "public", ["visitor", "stranger", "follower", "friend"]],
    ["public", "friends", ["visitor", "stranger", "follower", "friend"]],
    ["public", "private", []],
    ["friends", "public", ["friend"]],
    ["friends", "friends", ["friend"]],
    ["friends", "private", []],
    ["private", "public", []],
  ])(
    "a %s review of a %s profile is seen by %j",
    async (level, profile, seenBy) => {
      const ana = await person(profile);
      const [stranger, follower, friend] = [
        await person(),
        await person(),
        await person(),
      ];
      await follow(follower, ana);
      await follow(friend, ana);
      await follow(ana, friend);
      // A private entry: the review has a level of its own.
      const media = await titleOf(ana, { entry: "private" });
      await review(ana, media, { visibility: level });

      const viewers: Record<Viewer, Person | null> = {
        visitor: null,
        stranger,
        follower,
        friend,
      };
      const seen: Viewer[] = [];
      for (const [name, viewer] of Object.entries(viewers)) {
        if ((await authorsSeenBy(viewer, media)).length > 0) {
          seen.push(name as Viewer);
        }
      }
      expect(seen).toEqual(seenBy);
      expect(await authorsSeenBy(ana, media)).toEqual([ana.username]);
    },
  );

  it("hides it from a blocked person either way and from one who muted the author", async () => {
    const [ana, blocker, blocked, muter] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    const media = await titleOf(ana);
    await review(ana, media);
    await db.execute(sql`
      INSERT INTO blocks (blocker_id, blocked_id) VALUES
        (${blocker.id}::uuid, ${ana.id}::uuid), (${ana.id}::uuid, ${blocked.id}::uuid)`);
    await db.execute(
      sql`INSERT INTO mutes (muter_id, muted_id) VALUES (${muter.id}::uuid, ${ana.id}::uuid)`,
    );

    for (const viewer of [blocker, blocked, muter]) {
      expect(await authorsSeenBy(viewer, media)).toEqual([]);
    }
  });

  it("holds the reviews of an account less than a day old, then shows them", async () => {
    const [ana, bea] = [await person("public", 2), await person()];
    const media = await titleOf(ana);
    await review(ana, media);

    expect(await authorsSeenBy(bea, media)).toEqual([]);
    expect(await authorsSeenBy(ana, media)).toEqual([ana.username]);
    await db.execute(sql`
      UPDATE users SET created_at = now() - interval '25 hours' WHERE id = ${ana.id}::uuid`);
    expect(await authorsSeenBy(bea, media)).toEqual([ana.username]);
  });

  it("hides a removed review from everybody but its author, and an erased author's", async () => {
    const [ana, bea, cy] = [await person(), await person(), await person()];
    const media = await titleOf(ana);
    await entryOf(cy, media);
    await review(ana, media);
    await review(cy, media);
    await db.execute(
      sql`UPDATE reviews SET removed_at = now() WHERE user_id = ${ana.id}::uuid`,
    );
    await db.execute(
      sql`UPDATE users SET deleted_at = now() WHERE id = ${cy.id}::uuid`,
    );

    expect(await authorsSeenBy(bea, media)).toEqual([]);
    expect(await authorsSeenBy(ana, media)).toEqual([ana.username]);
  });

  it("shows the score only to who may see the library entry", async () => {
    const [ana, bea] = [await person(), await person()];
    const open = await titleOf(ana, { score: 8 });
    const closed = await titleOf(ana, { score: 6, entry: "private" });
    await review(ana, open);
    await review(ana, closed);

    const scoreOf = async (viewer: Person, media: string) =>
      (await readReviews(db, viewer.id, media, "recent", 1)).reviews[0]?.score;
    expect(await scoreOf(bea, open)).toBe(8);
    expect(await scoreOf(bea, closed)).toBeNull();
    expect(await scoreOf(ana, closed)).toBe(6);
  });

  it("puts the viewer's own first, then the most liked (ties by the newest) or the newest", async () => {
    const people = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    const [ana, bea, cy, dee] = people as [Person, Person, Person, Person];
    const media = await titleOf(ana);
    for (const one of [bea, cy, dee]) await entryOf(one, media);
    for (const [index, one] of [ana, bea, cy, dee].entries()) {
      await review(one, media);
      await db.execute(sql`
        UPDATE reviews SET created_at = '2026-11-20T00:00:00Z'::timestamptz + ${index} * interval '1 minute'
        WHERE user_id = ${one.id}::uuid`);
    }
    // Bea's review gets a like from Cy; the others none.
    const beaReview = (
      await readReviews(db, cy.id, media, "recent", 1)
    ).reviews.find((one) => one.author.username === bea.username);
    await setLike(db, cy.id, beaReview?.activityId ?? "", true);

    const order = async (viewer: Person, how: "relevant" | "recent") =>
      (await readReviews(db, viewer.id, media, how, 1)).reviews.map(
        (one) => one.author.username,
      );
    expect(await order(ana, "relevant")).toEqual([
      ana.username,
      bea.username,
      dee.username,
      cy.username,
    ]);
    expect(await order(ana, "recent")).toEqual([
      ana.username,
      dee.username,
      cy.username,
      bea.username,
    ]);
  });

  it("reads ten a page and says when there are more", async () => {
    const viewer = await person();
    const media = (await newMedia({ type: "anime", title: "Busy" })).id;
    for (let i = 0; i < 11; i += 1) {
      const author = await person();
      await entryOf(author, media);
      await review(author, media);
    }
    const first = await readReviews(db, viewer.id, media, "recent", 1);
    const second = await readReviews(db, viewer.id, media, "recent", 2);
    expect([first.reviews.length, first.more]).toEqual([10, true]);
    expect([second.reviews.length, second.more]).toEqual([1, false]);
  });
});

describe("the like of a review (ADR-056)", () => {
  it("can be given by anybody who sees the review, and is one count with the feed", async () => {
    const [ana, stranger, follower] = [
      await person(),
      await person(),
      await person(),
    ];
    await follow(follower, ana);
    const media = await titleOf(ana);
    await review(ana, media);
    const [shown] = (await readReviews(db, stranger.id, media, "recent", 1))
      .reviews;
    const eventId = shown?.activityId ?? "";

    expect(await setLike(db, stranger.id, eventId, true)).toEqual({ likes: 1 });
    const [inFeed] = (await readFeed(db, follower.id, "es", null)).events;
    expect(inFeed).toMatchObject({ id: eventId, type: "reviewed", likes: 1 });
    expect(await setLike(db, follower.id, eventId, true)).toEqual({ likes: 2 });
    expect(await setLike(db, ana.id, eventId, true)).toBeNull();
  });

  it("cannot be given to a review the person may not see", async () => {
    const [ana, stranger] = [await person(), await person()];
    const media = await titleOf(ana);
    await review(ana, media, { visibility: "friends" });
    const eventId = String(
      (await db.execute(sql`SELECT activity_id FROM reviews`)).rows[0]
        ?.activity_id,
    );

    expect(await setLike(db, stranger.id, eventId, true)).toBeNull();
    expect(await count(sql`SELECT count(*)::int AS n FROM likes`)).toBe(0);
  });
});

describe("a review in the feed", () => {
  it("shows at the review's level with its start and spoiler mark, not the entry's", async () => {
    const [ana, follower] = [await person(), await person()];
    await follow(follower, ana);
    const media = await titleOf(ana, { entry: "private" });
    await review(ana, media, { spoiler: true });

    const { events } = await readFeed(db, follower.id, "es", null);
    expect(events).toEqual([
      expect.objectContaining({
        type: "reviewed",
        level: "public",
        review: {
          id: expect.any(String) as unknown,
          start: expect.any(String) as unknown,
          more: true,
          spoiler: true,
          removed: false,
        },
      }),
    ]);
  });

  it("is hidden from followers while the account is new or the review was removed", async () => {
    const [ana, follower] = [await person("public", 2), await person()];
    await follow(follower, ana);
    const media = await titleOf(ana);
    await review(ana, media);

    expect((await readFeed(db, follower.id, "es", null)).events).toEqual([]);
    expect((await readFeed(db, ana.id, "es", null)).events).toHaveLength(1);
    await db.execute(sql`
      UPDATE users SET created_at = now() - interval '2 days' WHERE id = ${ana.id}::uuid`);
    expect((await readFeed(db, follower.id, "es", null)).events).toHaveLength(
      1,
    );
    await db.execute(sql`UPDATE reviews SET removed_at = now()`);
    expect((await readFeed(db, follower.id, "es", null)).events).toEqual([]);
  });

  it("never shows a reviewed event that has no review", async () => {
    const [ana, follower] = [await person(), await person()];
    await follow(follower, ana);
    const media = await titleOf(ana);
    await db.execute(sql`
      INSERT INTO activity (actor_id, type, media_id, visibility)
      VALUES (${ana.id}::uuid, 'reviewed', ${media}::uuid, 'public')`);

    expect((await readFeed(db, follower.id, "es", null)).events).toEqual([]);
  });
});
