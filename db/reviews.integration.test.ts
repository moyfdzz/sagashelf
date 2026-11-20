import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import { readFeed, setLike } from "../server/db/feed";
import { removeEntry } from "../server/db/library";
import {
  deleteReview,
  readReviews,
  saveReview,
  type ReviewInput,
} from "../server/db/reviews";
import { reviewFingerprint } from "../server/reviews/rules";
import type { Level } from "../server/social/can-view";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

// SAG-22, ADR-053 and ADR-056: reviews, who sees them, their rules and their likes, against the
// real Postgres. The expected tables are written by hand from the ADRs.

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

let titles = 0;

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
  titles = 0;
});

type Person = { id: string; username: string };

/** A person whose account is two days old, so their reviews are not held (ADR-053). */
async function person(
  privacy: Level = "public",
  ageHours = 48,
): Promise<Person> {
  const row = await newUser({ privacy });
  await db.execute(sql`
    UPDATE users SET created_at = now() - make_interval(hours => ${ageHours})
    WHERE id = ${row.id}::uuid`);
  return { id: row.id, username: row.username };
}

async function follow(follower: Person, followee: Person) {
  await db.execute(
    sql`INSERT INTO follows (follower_id, followee_id) VALUES (${follower.id}::uuid, ${followee.id}::uuid)`,
  );
}

/** A new title in the library of `who`, by hand (a custom title cannot be added by `addEntry`). */
async function titleOf(
  who: Person,
  options: {
    status?: string;
    entry?: Level;
    score?: number | null;
    mediaType?: "anime" | "custom";
  } = {},
): Promise<string> {
  titles += 1;
  const media = await newMedia({
    type: options.mediaType ?? "anime",
    title: `Title ${titles}`,
  });
  await entryOf(who, media.id, options);
  return media.id;
}

async function entryOf(
  who: Person,
  mediaId: string,
  options: { status?: string; entry?: Level; score?: number | null } = {},
) {
  await db.execute(sql`
    INSERT INTO library_entries (user_id, media_id, status, visibility, score)
    VALUES (${who.id}::uuid, ${mediaId}::uuid, ${options.status ?? "completed"}::library_status,
            ${options.entry ?? "public"}::privacy_level, ${options.score ?? null}::smallint)`);
}

const bodyFor = (seed: string) =>
  `${seed}. ${"Una reseña con algo de sustancia sobre la historia. ".repeat(12)}`.trim();

async function input(
  seed: string,
  options: Partial<Omit<ReviewInput, "body" | "fingerprint">> = {},
): Promise<ReviewInput> {
  const body = bodyFor(seed);
  return {
    body,
    fingerprint: await reviewFingerprint(body),
    spoiler: options.spoiler ?? false,
    visibility: options.visibility ?? "public",
  };
}

async function review(
  who: Person,
  mediaId: string,
  options: Partial<Omit<ReviewInput, "body" | "fingerprint">> = {},
) {
  const result = await saveReview(
    db,
    who.id,
    mediaId,
    await input(`${who.username} ${mediaId}`, options),
    randomUUID(),
  );
  expect(result).toBe("created");
}

const authorsSeenBy = async (viewer: Person | null, mediaId: string) =>
  (await readReviews(db, viewer?.id ?? null, mediaId, "recent", 1)).reviews.map(
    (one) => one.author.username,
  );

const count = async (query: ReturnType<typeof sql>) =>
  Number((await db.execute(query)).rows[0]?.n);

describe("writing a review", () => {
  it("writes the review and its reviewed event in one statement, with the same level", async () => {
    const ana = await person();
    const media = await titleOf(ana);
    const eventId = randomUUID();

    const result = await saveReview(
      db,
      ana.id,
      media,
      await input("first", { visibility: "friends", spoiler: true }),
      eventId,
    );

    expect(result).toBe("created");
    const { rows } = await db.execute(sql`
      SELECT r.spoiler, r.visibility::text AS level, a.id, a.type::text AS type,
             a.visibility::text AS event_level, a.actor_id
      FROM reviews r JOIN activity a ON a.id = r.activity_id
      WHERE r.user_id = ${ana.id}::uuid`);
    expect(rows).toEqual([
      {
        spoiler: true,
        level: "friends",
        id: eventId,
        type: "reviewed",
        event_level: "friends",
        actor_id: ana.id,
      },
    ]);
  });

  it.each(["in_progress", "paused", "completed", "dropped"])(
    "allows a title that is %s",
    async (status) => {
      const ana = await person();
      const media = await titleOf(ana, { status });
      await review(ana, media);
    },
  );

  it("refuses a planned title, a title not in the library and a title the person made", async () => {
    const ana = await person();
    const planned = await titleOf(ana, { status: "planned" });
    const absent = (await newMedia({ type: "anime", title: "Absent" })).id;
    const custom = await titleOf(ana, { mediaType: "custom" });

    for (const media of [planned, absent, custom]) {
      expect(
        await saveReview(db, ana.id, media, await input(media), randomUUID()),
      ).toBe("not_started");
    }
    expect(await count(sql`SELECT count(*)::int AS n FROM reviews`)).toBe(0);
    expect(await count(sql`SELECT count(*)::int AS n FROM activity`)).toBe(0);
  });

  it("edits the review without a new event, and moves the level of its event", async () => {
    const ana = await person();
    const media = await titleOf(ana);
    await review(ana, media);

    const edit = await input("edited", {
      visibility: "private",
      spoiler: true,
    });
    expect(await saveReview(db, ana.id, media, edit, randomUUID())).toBe(
      "updated",
    );

    const { rows } = await db.execute(sql`
      SELECT r.body, r.spoiler, a.visibility::text AS event_level
      FROM reviews r JOIN activity a ON a.id = r.activity_id`);
    expect(rows).toEqual([
      { body: edit.body, spoiler: true, event_level: "private" },
    ]);
    expect(await count(sql`SELECT count(*)::int AS n FROM activity`)).toBe(1);
  });

  it("keeps the review when the title goes back to planned, and lets it be edited", async () => {
    const ana = await person();
    const media = await titleOf(ana);
    await review(ana, media);
    await db.execute(sql`UPDATE library_entries SET status = 'planned'`);

    expect(
      await saveReview(db, ana.id, media, await input("again"), randomUUID()),
    ).toBe("updated");
  });

  it("refuses the same text, written differently, on another title of the same person", async () => {
    const [ana, bea] = [await person(), await person()];
    const first = await titleOf(ana);
    const second = await titleOf(ana);
    const original = await input("same words");
    await saveReview(db, ana.id, first, original, randomUUID());

    const shouted = original.body.toUpperCase().replaceAll(".", "!!  ");
    const copy = {
      ...original,
      body: shouted,
      fingerprint: await reviewFingerprint(shouted),
    };
    expect(copy.fingerprint).toBe(original.fingerprint);
    expect(await saveReview(db, ana.id, second, copy, randomUUID())).toBe(
      "duplicate",
    );
    // The same title may keep its own text, and another person may write the same words.
    expect(await saveReview(db, ana.id, first, original, randomUUID())).toBe(
      "updated",
    );
    await entryOf(bea, first);
    expect(await saveReview(db, bea.id, first, original, randomUUID())).toBe(
      "created",
    );
  });

  it("allows ten new reviews an hour, not counting edits or older reviews", async () => {
    const ana = await person();
    const old = await titleOf(ana);
    await review(ana, old);
    await db.execute(
      sql`UPDATE reviews SET created_at = now() - interval '61 minutes'`,
    );
    const media: string[] = [];
    for (let i = 0; i < 11; i += 1) media.push(await titleOf(ana));
    for (const one of media.slice(0, 10)) await review(ana, one);

    const eleventh = media[10] ?? "";
    expect(
      await saveReview(db, ana.id, eleventh, await input("11"), randomUUID()),
    ).toBe("rate_limited");
    // An edit is not a new review.
    expect(
      await saveReview(db, ana.id, old, await input("edit"), randomUUID()),
    ).toBe("updated");
    expect(await count(sql`SELECT count(*)::int AS n FROM reviews`)).toBe(11);
  });

  it("refuses a text out of the length or a fingerprint that is not one, in the database too", async () => {
    const ana = await person();
    const media = await titleOf(ana);
    const short = { ...(await input("x")), body: "corta" };
    await expect(
      saveReview(db, ana.id, media, short, randomUUID()),
    ).rejects.toThrow();
    const bad = { ...(await input("y")), fingerprint: "not-a-hash" };
    await expect(
      saveReview(db, ana.id, media, bad, randomUUID()),
    ).rejects.toThrow();
  });
});

describe("deleting a review", () => {
  it("deletes the review, its event and the likes of the event", async () => {
    const [ana, bea] = [await person(), await person()];
    const media = await titleOf(ana);
    await review(ana, media);
    const [shown] = (await readReviews(db, bea.id, media, "recent", 1)).reviews;
    expect(await setLike(db, bea.id, shown?.activityId ?? "", true)).toEqual({
      likes: 1,
    });

    expect(await deleteReview(db, ana.id, media)).toBe(true);
    expect(await deleteReview(db, ana.id, media)).toBe(false);
    for (const table of ["reviews", "activity", "likes"]) {
      expect(
        await count(
          sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
        ),
      ).toBe(0);
    }
  });

  it("goes with the title when it is removed from the library", async () => {
    const [ana, bea] = [await person(), await person()];
    const media = await titleOf(ana);
    await review(ana, media);
    const [shown] = (await readReviews(db, bea.id, media, "recent", 1)).reviews;
    await setLike(db, bea.id, shown?.activityId ?? "", true);

    expect(await removeEntry(db, ana.id, media)).toBe(true);
    for (const table of ["reviews", "activity", "likes"]) {
      expect(
        await count(
          sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
        ),
      ).toBe(0);
    }
  });

  it("never leaves a review without its event: deleting the event alone fails", async () => {
    const ana = await person();
    const media = await titleOf(ana);
    await review(ana, media);
    await expect(
      db.execute(sql`DELETE FROM activity WHERE type = 'reviewed'`),
    ).rejects.toThrow();
  });
});

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
          start: expect.any(String) as unknown,
          more: true,
          spoiler: true,
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

describe("the export", () => {
  it("has every review of the person, and the title of a liked review", async () => {
    const [ana, bea] = [await person(), await person()];
    const media = await titleOf(ana);
    await review(ana, media, { visibility: "friends", spoiler: true });
    await review(bea, await titleOf(bea));
    const [shown] = (
      await readReviews(db, ana.id, await titleOfBea(), "recent", 1)
    ).reviews;
    await setLike(db, ana.id, shown?.activityId ?? "", true);

    const data = await exportAccount(db, ana.id);
    expect(data?.reviews).toEqual([
      expect.objectContaining({
        title: "Title 1",
        spoiler: true,
        visibility: "friends",
        removed: false,
        body: expect.stringContaining("sustancia") as unknown,
      }),
    ]);
    expect(data?.likes).toEqual([
      expect.objectContaining({ type: "reviewed", title: "Title 2" }),
    ]);

    async function titleOfBea() {
      const { rows } = await db.execute(
        sql`SELECT media_id FROM reviews WHERE user_id = ${bea.id}::uuid`,
      );
      return String(rows[0]?.media_id);
    }
  });
});
