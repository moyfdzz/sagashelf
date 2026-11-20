import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import { setLike } from "../server/db/feed";
import { removeEntry } from "../server/db/library";
import { deleteReview, readReviews, saveReview } from "../server/db/reviews";
import { reviewFingerprint } from "../server/reviews/rules";
import { createTestDb } from "./test-database";
import { input, reviewFixtures } from "./review-fixtures";

// SAG-22, ADR-053 and ADR-056: writing, deleting and exporting reviews, against the real Postgres.
// The expected tables are written by hand from the ADRs.

const { db, pool } = createTestDb();
const { newMedia, reset, person, entryOf, titleOf, review, count } =
  reviewFixtures(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(reset);

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

  it("allows ten new reviews an hour, not counting edits or the hour before", async () => {
    const ana = await person();
    const old = await titleOf(ana);
    await review(ana, old);
    // The window of that first review closed an hour ago.
    await db.execute(
      sql`UPDATE users SET reviews_hour_start = now() - interval '61 minutes' WHERE id = ${ana.id}::uuid`,
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

  it("still counts a review that was deleted, so deleting and writing again does not get past the limit", async () => {
    const ana = await person();
    const media = await titleOf(ana);
    for (let i = 0; i < 10; i += 1) {
      await review(ana, media);
      expect(await deleteReview(db, ana.id, media)).toBe(true);
    }

    expect(
      await saveReview(db, ana.id, media, await input("again"), randomUUID()),
    ).toBe("rate_limited");
    expect(await count(sql`SELECT count(*)::int AS n FROM activity`)).toBe(0);
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
