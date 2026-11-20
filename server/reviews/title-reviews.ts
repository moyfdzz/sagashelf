import { z } from "zod";

import { getOwnReview, isReviewable, readReviews } from "../db/reviews";
import type { SqlExecutor } from "../db/clerk-sync";
import { personCard } from "../db/person";
import type { LibraryStatus } from "../library/schema";
import { splitExcerpt } from "./rules";

/**
 * The reviews block of a title page (SAG-22, ADR-053 and ADR-056): one page of the reviews the viewer
 * may see, and what the viewer may do (write one, edit theirs, start the title first).
 */

/** The most pages the address may ask for: a stale or made-up number shows the last one we allow. */
export const maxReviewPage = 100;

const queryOf = z.object({
  order: z.enum(["relevant", "recent"]).catch("relevant"),
  page: z.coerce.number().int().min(1).max(maxReviewPage).catch(1),
});

/** The order and the page of the reviews, from `?reviews=` and `?reviewsPage=`. */
export function reviewQueryOf(params: URLSearchParams) {
  return queryOf.parse({
    order: params.get("reviews") ?? undefined,
    page: params.get("reviewsPage") ?? undefined,
  });
}

export type ReviewItem = {
  id: string;
  /** The event that carries the likes; null hides the like button. */
  activityId: string | null;
  excerpt: string;
  /** The rest of the text after the excerpt; empty when the whole review fits. */
  rest: string;
  spoiler: boolean;
  level: "public" | "friends" | "private";
  createdAt: string;
  edited: boolean;
  mine: boolean;
  /** Removed by a moderator: only its author sees it, with a note that says so (ADR-057). */
  removed: boolean;
  author: ReturnType<typeof personCard>;
  score: number | null;
  likes: number;
  liked: boolean;
};

/**
 * What the viewer may do: `sign_in` (a visitor), `start_first` (no entry, or a planned one), `write`,
 * or `edit` (they have a review, which stays even if the title went back to planned).
 */
export type ReviewWrite = "sign_in" | "start_first" | "write" | "edit";

export type TitleReviews = {
  order: "relevant" | "recent";
  page: number;
  more: boolean;
  items: ReviewItem[];
  write: ReviewWrite;
};

// An edit within a minute of writing is part of writing it.
const editedAfterMs = 60_000;

export async function titleReviews(
  db: SqlExecutor,
  viewer: { id: string } | null,
  entryStatus: LibraryStatus | null,
  mediaId: string,
  params: URLSearchParams,
): Promise<TitleReviews> {
  const { order, page } = reviewQueryOf(params);
  const started = entryStatus !== null && isReviewable(entryStatus);
  const [read, own] = await Promise.all([
    readReviews(db, viewer?.id ?? null, mediaId, order, page),
    viewer ? getOwnReview(db, viewer.id, mediaId) : null,
  ]);
  const write: ReviewWrite = !viewer
    ? "sign_in"
    : own
      ? "edit"
      : started
        ? "write"
        : "start_first";
  return {
    order,
    page,
    more: read.more,
    write,
    items: read.reviews.map((review) => {
      const { excerpt, rest } = splitExcerpt(review.body);
      return {
        id: review.id,
        activityId: review.activityId,
        excerpt,
        rest,
        spoiler: review.spoiler,
        level: review.level,
        createdAt: review.createdAt.toISOString(),
        edited:
          review.updatedAt.getTime() - review.createdAt.getTime() >
          editedAfterMs,
        mine: review.mine,
        removed: review.removed,
        author: personCard(review.author),
        score: review.score,
        likes: review.likes,
        liked: review.liked,
      };
    }),
  };
}
