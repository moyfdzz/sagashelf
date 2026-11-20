import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { warnPerson } from "../server/db/account-actions";
import { dismissReport, listOpenReports } from "../server/db/moderation";
import { createReport } from "../server/db/reports";
import {
  askSpoilerMark,
  closeFixedReview,
  findMyReviewReport,
  findReportableReview,
  removeReview,
} from "../server/db/review-reports";
import {
  deleteReview,
  getOwnReview,
  readReviews,
  saveReview,
} from "../server/db/reviews";
import { readFeed } from "../server/db/feed";
import { createTestDb } from "./test-database";
import { input, reviewFixtures, type Person } from "./review-fixtures";
import { failsWith } from "./test-helpers";

// SAG-22, ADR-057: reports on a review and what the moderation panel does about them, against the
// real Postgres. The expected rows are written by hand from the decisions of the ADR.

const { db, pool } = createTestDb();
const { reset, person, titleOf, review, authorsSeenBy, count, follow } =
  reviewFixtures(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(reset);

const reviewIdOf = async (who: Person, mediaId: string) => {
  const { rows } = await db.execute(sql`
    SELECT id FROM reviews WHERE user_id = ${who.id}::uuid AND media_id = ${mediaId}::uuid`);
  const id = rows[0]?.id;
  if (typeof id !== "string") throw new Error("no review");
  return id;
};

async function reportReview(
  reporter: Person,
  author: Person,
  reviewId: string,
  reason: "spoiler" | "spam" | "harassment" = "spoiler",
) {
  return createReport(db, {
    reporterId: reporter.id,
    targetId: author.id,
    kind: "review",
    reason,
    details: "Dice quién muere al final.",
    pictureUrl: null,
    reviewId,
  });
}

const reportIdOf = async (reporter: Person, reviewId: string) => {
  const mine = await findMyReviewReport(db, reporter.id, reviewId);
  if (!mine) throw new Error("no report");
  return mine.id;
};

const statusesOf = async (reviewId: string) =>
  (
    await db.execute(sql`
      SELECT status::text AS status FROM reports WHERE review_id = ${reviewId}::uuid
      ORDER BY created_at, id`)
  ).rows.map((row) => row.status);

const notificationsOf = async (who: Person) =>
  (
    await db.execute(sql`
      SELECT type, payload FROM notifications WHERE user_id = ${who.id}::uuid ORDER BY created_at`)
  ).rows.map((row) => ({ type: row.type, payload: row.payload }));

const auditActions = async () =>
  (
    await db.execute(
      sql`SELECT action, target_type FROM audit_log ORDER BY created_at, id`,
    )
  ).rows.map((row) => `${String(row.action)} ${String(row.target_type)}`);

/** An author with a public review, a reader who can see it, and an administrator. */
async function scene() {
  const [ana, bea, admin] = [await person(), await person(), await person()];
  await db.execute(
    sql`UPDATE users SET role = 'admin' WHERE id = ${admin.id}::uuid`,
  );
  const media = await titleOf(ana);
  await review(ana, media);
  const reviewId = await reviewIdOf(ana, media);
  return { ana, bea, admin, media, reviewId };
}

describe("reporting a review", () => {
  it("keeps the author as the target and the review apart, and tells the administrators", async () => {
    const { ana, bea, admin, reviewId } = await scene();

    expect(await reportReview(bea, ana, reviewId)).toBe("reported");
    const { rows } = await db.execute(sql`
      SELECT target_type::text AS kind, target_id, review_id, reason::text AS reason FROM reports`);
    expect(rows).toEqual([
      {
        kind: "review",
        target_id: ana.id,
        review_id: reviewId,
        reason: "spoiler",
      },
    ]);
    expect(await notificationsOf(admin)).toEqual([
      {
        type: "report.created",
        payload: {
          kind: "review",
          reason: "spoiler",
          username: ana.username,
          targetId: ana.id,
        },
      },
    ]);
  });

  it("is one open report per review, and another review of the same author is another report", async () => {
    const { ana, bea, reviewId } = await scene();
    const second = await titleOf(ana);
    await review(ana, second);
    const otherId = await reviewIdOf(ana, second);

    expect(await reportReview(bea, ana, reviewId)).toBe("reported");
    expect(await reportReview(bea, ana, reviewId, "spam")).toBe("duplicate");
    expect(await reportReview(bea, ana, otherId)).toBe("reported");
  });

  it("finds a review the person may see, never their own, a hidden one or a removed one", async () => {
    const { ana, bea, admin, reviewId } = await scene();
    const carl = await person();
    const hidden = await titleOf(ana);
    await review(ana, hidden, { visibility: "friends" });
    const hiddenId = await reviewIdOf(ana, hidden);

    expect((await findReportableReview(db, bea.id, reviewId))?.authorId).toBe(
      ana.id,
    );
    expect(await findReportableReview(db, ana.id, reviewId)).toBeNull();
    expect(await findReportableReview(db, bea.id, hiddenId)).toBeNull();
    expect(await findReportableReview(db, bea.id, randomUUID())).toBeNull();

    await reportReview(carl, ana, reviewId);
    expect(
      await removeReview(db, admin.id, await reportIdOf(carl, reviewId)),
    ).toBe(true);
    expect(await findReportableReview(db, bea.id, reviewId)).toBeNull();
  });
});

describe("the moderation queue", () => {
  it("shows the review, and says it is gone when the author deleted it", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    await reportReview(bea, ana, reviewId);

    const [listed] = await listOpenReports(db, admin.id);
    expect(listed?.kind).toBe("review");
    expect(listed?.username).toBe(ana.username);
    expect(listed?.review?.spoiler).toBe(false);
    expect(listed?.review?.spoilerRequestedAt).toBeNull();
    expect(listed?.review?.media.id).toBe(media);
    expect(listed?.review?.body.length).toBeGreaterThanOrEqual(500);

    expect(await deleteReview(db, ana.id, media)).toBe(true);
    const [after] = await listOpenReports(db, admin.id);
    expect(after?.kind).toBe("review");
    expect(after?.review).toBeNull();
    // The author is still known: a warning reaches them.
    expect(
      await warnPerson(db, admin.id, { reportId: after?.id ?? "" }, "spoiler"),
    ).toBe(true);
  });
});

describe("removing a review", () => {
  it("hides it from everybody but its author, resolves every report of it and tells the author", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    const carl = await person();
    await follow(bea, ana);
    await reportReview(bea, ana, reviewId);
    await reportReview(carl, ana, reviewId, "spam");

    expect(
      await removeReview(db, admin.id, await reportIdOf(bea, reviewId)),
    ).toBe(true);

    expect(await statusesOf(reviewId)).toEqual(["resolved", "resolved"]);
    expect(await authorsSeenBy(bea, media)).toEqual([]);
    expect(await authorsSeenBy(null, media)).toEqual([]);
    const own = await readReviews(db, ana.id, media, "recent", 1);
    expect(own.reviews.map((one) => [one.mine, one.removed])).toEqual([
      [true, true],
    ]);
    expect((await readFeed(db, bea.id, "es", null)).events).toEqual([]);
    const [mine] = (await readFeed(db, ana.id, "es", null)).events;
    expect(mine?.review?.removed).toBe(true);
    expect(mine?.review?.id).toBe(reviewId);

    expect(await notificationsOf(ana)).toEqual([
      {
        type: "moderation.review_removed",
        payload: { mediaId: media, title: "Title 1", reason: "spoiler" },
      },
    ]);
    expect(await auditActions()).toEqual(["review.removed review"]);
    // Removing is not an edit: the review keeps its time.
    expect(
      await count(sql`
        SELECT count(*)::int AS n FROM reviews
        WHERE id = ${reviewId}::uuid AND updated_at = created_at`),
    ).toBe(1);
  });

  it("is done once, and the author can then only delete it", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    await reportReview(bea, ana, reviewId);
    const reportId = await reportIdOf(bea, reviewId);

    expect(await removeReview(db, admin.id, reportId)).toBe(true);
    expect(await removeReview(db, admin.id, reportId)).toBe(false);
    expect((await getOwnReview(db, ana.id, media))?.removed).toBe(true);
    expect(
      await saveReview(
        db,
        ana.id,
        media,
        await input("una nueva versión"),
        randomUUID(),
      ),
    ).toBe("removed");
    expect(await deleteReview(db, ana.id, media)).toBe(true);
  });

  it("refuses the review of another administrator, the administrator's own and a deleted one", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    const other = await person();
    await db.execute(
      sql`UPDATE users SET role = 'admin' WHERE id = ${other.id}::uuid`,
    );
    const otherMedia = await titleOf(other);
    await review(other, otherMedia);
    const otherReview = await reviewIdOf(other, otherMedia);
    await reportReview(bea, other, otherReview);
    const ownMedia = await titleOf(admin);
    await review(admin, ownMedia);
    const ownReview = await reviewIdOf(admin, ownMedia);
    await reportReview(bea, admin, ownReview);
    await reportReview(bea, ana, reviewId);

    expect(
      await removeReview(db, admin.id, await reportIdOf(bea, otherReview)),
    ).toBe(false);
    expect(
      await removeReview(db, admin.id, await reportIdOf(bea, ownReview)),
    ).toBe(false);
    const anaReport = await reportIdOf(bea, reviewId);
    await deleteReview(db, ana.id, media);
    expect(await removeReview(db, admin.id, anaReport)).toBe(false);
    expect(await auditActions()).toEqual([]);
  });

  it("does not remove again with a report that arrived after the removal", async () => {
    const { ana, bea, admin, reviewId } = await scene();
    const carl = await person();
    await reportReview(bea, ana, reviewId);
    await removeReview(db, admin.id, await reportIdOf(bea, reviewId));
    const before = await db.execute(
      sql`SELECT removed_at::text AS at FROM reviews WHERE id = ${reviewId}::uuid`,
    );
    // The page refuses to report a removed review; this one is written by hand.
    await db.execute(sql`
      INSERT INTO reports (reporter_id, target_type, target_id, reason, review_id)
      VALUES (${carl.id}::uuid, 'review', ${ana.id}::uuid, 'spam', ${reviewId}::uuid)`);

    expect(
      await removeReview(db, admin.id, await reportIdOf(carl, reviewId)),
    ).toBe(false);
    const after = await db.execute(
      sql`SELECT removed_at::text AS at FROM reviews WHERE id = ${reviewId}::uuid`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(await auditActions()).toEqual(["review.removed review"]);
    const [listed] = await listOpenReports(db, admin.id);
    expect(listed?.review?.removed).toBe(true);
  });

  it("refuses a report that is not of a review", async () => {
    const { ana, bea, admin } = await scene();
    await createReport(db, {
      reporterId: bea.id,
      targetId: ana.id,
      kind: "user",
      reason: "spam",
      details: null,
      pictureUrl: null,
    });
    const { rows } = await db.execute(sql`SELECT id FROM reports`);
    expect(await removeReview(db, admin.id, String(rows[0]?.id))).toBe(false);
  });
});

describe("asking the author to mark a spoiler", () => {
  it("records the ask, keeps the reports waiting and tells the author, once", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    await reportReview(bea, ana, reviewId);
    const reportId = await reportIdOf(bea, reviewId);

    expect(await askSpoilerMark(db, admin.id, reportId)).toBe(true);
    expect(await askSpoilerMark(db, admin.id, reportId)).toBe(false);

    expect(await statusesOf(reviewId)).toEqual(["reviewing"]);
    expect((await getOwnReview(db, ana.id, media))?.spoilerAsked).toBe(true);
    const [listed] = await listOpenReports(db, admin.id);
    expect(listed?.review?.spoilerRequestedAt).toBeInstanceOf(Date);
    expect(await notificationsOf(ana)).toEqual([
      {
        type: "moderation.review_spoiler",
        payload: { mediaId: media, title: "Title 1", reason: "spoiler" },
      },
    ]);
    // Still shown while it waits.
    expect(await authorsSeenBy(bea, media)).toEqual([ana.username]);
  });

  it("closes the reports only after the author marked it", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    await reportReview(bea, ana, reviewId);
    const reportId = await reportIdOf(bea, reviewId);
    await askSpoilerMark(db, admin.id, reportId);

    expect(await closeFixedReview(db, admin.id, reportId)).toBe(false);
    expect(
      await saveReview(
        db,
        ana.id,
        media,
        await input(`${ana.username} ${media}`, { spoiler: true }),
        randomUUID(),
      ),
    ).toBe("updated");
    expect((await getOwnReview(db, ana.id, media))?.spoilerAsked).toBe(false);
    expect(await closeFixedReview(db, admin.id, reportId)).toBe(true);

    expect(await statusesOf(reviewId)).toEqual(["resolved"]);
    expect(await auditActions()).toEqual([
      "review.spoiler_requested review",
      "review.spoiler_fixed review",
    ]);
  });

  it("leaves a report for another reason alone, and is refused from one", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    const carl = await person();
    await reportReview(bea, ana, reviewId);
    await reportReview(carl, ana, reviewId, "harassment");
    const carlReport = await reportIdOf(carl, reviewId);

    expect(await askSpoilerMark(db, admin.id, carlReport)).toBe(false);
    expect(
      await askSpoilerMark(db, admin.id, await reportIdOf(bea, reviewId)),
    ).toBe(true);
    expect(await statusesOf(reviewId)).toEqual(["reviewing", "open"]);

    await saveReview(
      db,
      ana.id,
      media,
      await input(`${ana.username} ${media}`, { spoiler: true }),
      randomUUID(),
    );
    expect(await closeFixedReview(db, admin.id, carlReport)).toBe(false);
    expect(
      await closeFixedReview(db, admin.id, await reportIdOf(bea, reviewId)),
    ).toBe(true);
    expect(await statusesOf(reviewId)).toEqual(["resolved", "open"]);
  });

  it("ends when the waiting report is answered, and a new report can ask again", async () => {
    const { ana, bea, admin, media, reviewId } = await scene();
    const carl = await person();
    await reportReview(bea, ana, reviewId);
    const first = await reportIdOf(bea, reviewId);
    await askSpoilerMark(db, admin.id, first);
    await dismissReport(db, admin.id, first);

    expect((await getOwnReview(db, ana.id, media))?.spoilerAsked).toBe(false);
    await reportReview(carl, ana, reviewId);
    const second = await reportIdOf(carl, reviewId);
    const [listed] = await listOpenReports(db, admin.id);
    expect(listed?.review?.spoilerRequestedAt).toBeNull();

    expect(await askSpoilerMark(db, admin.id, second)).toBe(true);
    expect((await getOwnReview(db, ana.id, media))?.spoilerAsked).toBe(true);
    expect((await notificationsOf(ana)).map((one) => one.type)).toEqual([
      "moderation.review_spoiler",
      "moderation.review_spoiler",
    ]);
  });

  it("closes nothing when nobody asked, even with the mark", async () => {
    const { ana, bea, admin } = await scene();
    const media = await titleOf(ana);
    await review(ana, media, { spoiler: true });
    const reviewId = await reviewIdOf(ana, media);
    await reportReview(bea, ana, reviewId);

    expect(
      await closeFixedReview(db, admin.id, await reportIdOf(bea, reviewId)),
    ).toBe(false);
  });

  it("is refused for a review already marked as a spoiler", async () => {
    const { ana, bea, admin } = await scene();
    const media = await titleOf(ana);
    await review(ana, media, { spoiler: true });
    const reviewId = await reviewIdOf(ana, media);
    await reportReview(bea, ana, reviewId);

    expect(
      await askSpoilerMark(db, admin.id, await reportIdOf(bea, reviewId)),
    ).toBe(false);
  });

  it("lets a waiting report be dismissed", async () => {
    const { ana, bea, admin, reviewId } = await scene();
    await reportReview(bea, ana, reviewId);
    const reportId = await reportIdOf(bea, reviewId);
    await askSpoilerMark(db, admin.id, reportId);

    expect(await dismissReport(db, admin.id, reportId)).toBe(true);
    expect(await statusesOf(reviewId)).toEqual(["dismissed"]);
  });
});

describe("the columns of a report of a review", () => {
  it("needs a review for the kind review and refuses one for any other kind", async () => {
    const { ana, bea, reviewId } = await scene();
    const check = { code: "23514", constraint: "reports_review_id_check" };
    expect(
      await failsWith(
        db.execute(sql`
          INSERT INTO reports (reporter_id, target_type, target_id, reason)
          VALUES (${bea.id}::uuid, 'review', ${ana.id}::uuid, 'spam')`),
      ),
    ).toEqual(check);
    expect(
      await failsWith(
        db.execute(sql`
          INSERT INTO reports (reporter_id, target_type, target_id, reason, review_id)
          VALUES (${bea.id}::uuid, 'user', ${ana.id}::uuid, 'spam', ${reviewId}::uuid)`),
      ),
    ).toEqual(check);
  });
});
