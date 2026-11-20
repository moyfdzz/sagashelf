import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { Avatar } from "~/components/Avatar";
import { LikeButton } from "~/components/LikeButton";
import { SpoilerGuard } from "~/components/reviews/SpoilerGuard";
import { useFormatters } from "~/lib/format";
import { linkClass, tabClass } from "~/lib/ui";
import type {
  ReviewItem,
  TitleReviewsData as Reviews,
} from "~/routes/media.$type.$slug";

const summaryClass =
  "hover:text-link-hover focus-visible:outline-accent inline-flex min-h-10 cursor-pointer items-center rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";

/** One review: who, when, the score, the text (behind a warning when it has spoilers), its likes. */
function ReviewCard({ review, path }: { review: ReviewItem; path: string }) {
  const { t } = useTranslation();
  const { formatRelativeTime } = useFormatters();
  const own = review.author.displayName ?? review.author.username;

  return (
    <li className="border-border bg-surface-raised rounded-md border p-4">
      <article aria-label={t("reviews.byLabel", { name: own })}>
        <div className="flex items-center gap-3">
          <Avatar name={own} url={review.author.avatarUrl} size="sm" />
          <p className="flex min-w-0 flex-wrap items-center gap-x-2">
            {review.mine ? (
              <span className="font-semibold">{t("reviews.yours")}</span>
            ) : (
              <Link
                to={`/u/${encodeURIComponent(review.author.username)}`}
                className={linkClass}
              >
                {own}
              </Link>
            )}
            <time dateTime={review.createdAt} className="text-fg-muted text-sm">
              {formatRelativeTime(new Date(review.createdAt))}
            </time>
            {review.edited ? (
              <span className="text-fg-muted text-sm">
                {t("reviews.edited")}
              </span>
            ) : null}
            {review.mine && review.level !== "public" ? (
              <span className="text-fg-muted text-sm">
                {review.level === "friends"
                  ? t("feed.level.friends")
                  : t("feed.level.private")}
              </span>
            ) : null}
          </p>
        </div>
        {review.score !== null ? (
          <p className="mt-2 font-semibold">
            {t("reviews.score", { score: review.score })}
          </p>
        ) : null}
        <SpoilerGuard spoiler={review.spoiler}>
          <p className="mt-2 break-words whitespace-pre-line">
            {review.excerpt}
          </p>
          {review.rest ? (
            <details className="mt-1">
              <summary className={summaryClass}>{t("reviews.seeMore")}</summary>
              <p className="break-words whitespace-pre-line">{review.rest}</p>
            </details>
          ) : null}
        </SpoilerGuard>
        {review.activityId ? (
          <div className="mt-3">
            <LikeButton
              activityId={review.activityId}
              likes={review.likes}
              liked={review.liked}
              mine={review.mine}
              action={path}
            />
          </div>
        ) : null}
      </article>
    </li>
  );
}

/**
 * The reviews of a title (SAG-22, ADR-053): the viewer's own first, then the most liked or the
 * newest, ten a page. `path` is the address of the page, where the likes are posted.
 */
export function TitleReviews({
  reviews,
  mediaId,
  path,
}: {
  reviews: Reviews;
  mediaId: string;
  path: string;
}) {
  const { t } = useTranslation();
  // A like sent without JavaScript comes back to this same order and page.
  const here = `${path}${useLocation().search}`;
  const search = (order: Reviews["order"], page: number) => {
    const params = new URLSearchParams();
    if (order !== "relevant") params.set("reviews", order);
    if (page > 1) params.set("reviewsPage", String(page));
    return { search: params.toString(), hash: "reviews" };
  };

  return (
    <section id="reviews" aria-labelledby="reviews-title" className="mt-10">
      <h2 id="reviews-title" className="text-xl font-semibold">
        {t("reviews.title")}
      </h2>

      {reviews.write === "write" || reviews.write === "edit" ? (
        <p className="mt-2">
          {/* A plain link: the form is a session page with its own security policy (ADR-018). */}
          <a href={`/library/${mediaId}/review`} className={linkClass}>
            {reviews.write === "write" ? t("reviews.write") : t("reviews.edit")}
          </a>
        </p>
      ) : null}
      {reviews.write === "start_first" ? (
        <p className="text-fg-muted mt-2">{t("reviews.startFirst")}</p>
      ) : null}

      <nav
        aria-label={t("reviews.orderLabel")}
        className="mt-4 flex flex-wrap gap-2"
      >
        {(["relevant", "recent"] as const).map((order) => (
          <Link
            key={order}
            to={search(order, 1)}
            preventScrollReset
            aria-current={reviews.order === order ? "page" : undefined}
            className={tabClass(reviews.order === order)}
          >
            {order === "relevant" ? t("reviews.relevant") : t("reviews.recent")}
          </Link>
        ))}
      </nav>

      {reviews.items.length === 0 ? (
        <p className="text-fg-muted mt-4">
          {reviews.page > 1 ? t("reviews.noMore") : t("reviews.empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {reviews.items.map((review) => (
            <ReviewCard key={review.id} review={review} path={here} />
          ))}
        </ul>
      )}

      {reviews.page > 1 || reviews.more ? (
        <nav
          aria-label={t("reviews.pagesLabel")}
          className="mt-4 flex flex-wrap justify-between gap-3"
        >
          {reviews.page > 1 ? (
            <Link
              to={search(reviews.order, reviews.page - 1)}
              preventScrollReset
              className={linkClass}
            >
              {t("reviews.previous")}
            </Link>
          ) : (
            <span />
          )}
          {reviews.more ? (
            <Link
              to={search(reviews.order, reviews.page + 1)}
              preventScrollReset
              className={linkClass}
            >
              {t("reviews.more")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
