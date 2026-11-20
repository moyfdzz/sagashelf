import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Avatar } from "~/components/Avatar";
import { LikeButton } from "~/components/LikeButton";
import { SpoilerGuard } from "~/components/reviews/SpoilerGuard";
import { useFormatters } from "~/lib/format";
import { linkClass } from "~/lib/ui";
import type { FeedItem } from "~/routes/social";

/** What the event says happened, in the language of the page. */
function useWhat(item: FeedItem): string {
  const { t } = useTranslation();
  switch (item.kind) {
    case "progressed":
      if (!item.progress) return "";
      switch (item.progress.unit) {
        case "episodes":
          return t("feed.kinds.progressed_episodes", {
            count: item.progress.count,
          });
        case "pages":
          return t("feed.kinds.progressed_pages", {
            count: item.progress.count,
          });
        case "chapters":
          return t("feed.kinds.progressed_chapters", {
            count: item.progress.count,
          });
        case "volumes":
          return t("feed.kinds.progressed_volumes", {
            count: item.progress.count,
          });
      }
      return "";
    case "rated":
      return t("feed.kinds.rated", { score: item.score });
    case "started":
      return t("feed.kinds.started");
    case "restarted":
      return t("feed.kinds.restarted");
    case "completed":
      return t("feed.kinds.completed");
    case "dropped":
      return t("feed.kinds.dropped");
    case "reviewed":
      return t("feed.kinds.reviewed");
  }
}

/**
 * One event of the feed (SAG-22): who, what and when, the title, the start of a review, and its
 * likes.
 */
export function FeedEntry({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  const { formatRelativeTime } = useFormatters();
  const what = useWhat(item);
  const own = item.actor.displayName ?? item.actor.username;
  const name = item.mine ? t("feed.you") : own;

  return (
    <li className="border-border bg-surface-raised rounded-md border p-3">
      <article className="flex gap-3">
        <Avatar name={own} url={item.actor.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2">
            {item.mine ? (
              <span className="font-semibold">{name}</span>
            ) : (
              <Link
                to={`/u/${encodeURIComponent(item.actor.username)}`}
                className={linkClass}
              >
                {name}
              </Link>
            )}
            <time dateTime={item.createdAt} className="text-fg-muted text-sm">
              {formatRelativeTime(new Date(item.createdAt))}
            </time>
            {item.mine && item.level !== "public" ? (
              <span className="text-fg-muted text-sm">
                {item.level === "friends"
                  ? t("feed.level.friends")
                  : t("feed.level.private")}
              </span>
            ) : null}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2">
            <span>{what}</span>
            <Link to={item.media.href} className={linkClass}>
              {item.media.title}
            </Link>
          </p>
          {item.review ? (
            <SpoilerGuard spoiler={item.review.spoiler}>
              <p className="mt-2 break-words whitespace-pre-line">
                {item.review.excerpt}
                {item.review.more ? t("reviews.ellipsis") : null}
              </p>
            </SpoilerGuard>
          ) : null}
          {item.review?.more ? (
            <p className="mt-1">
              <Link to={`${item.media.href}#reviews`} className={linkClass}>
                {t("feed.readReview")}
              </Link>
            </p>
          ) : null}
          <div className="mt-2">
            <LikeButton
              activityId={item.id}
              likes={item.likes}
              liked={item.liked}
              mine={item.mine}
              action="/social"
            />
          </div>
        </div>
        {item.media.poster ? (
          // The title is written next to it, so a screen reader skips the picture.
          // A picture that fails to load must not stretch the card with its alt text.
          <span
            aria-hidden="true"
            className="h-18 w-12 shrink-0 overflow-hidden"
          >
            <img
              src={item.media.poster}
              alt={t("media.posterAlt", { title: item.media.title })}
              width={48}
              height={72}
              loading="lazy"
              className="border-border h-18 w-12 rounded-sm border object-cover"
            />
          </span>
        ) : null}
      </article>
    </li>
  );
}
