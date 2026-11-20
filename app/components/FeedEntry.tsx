import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";

import { Avatar } from "~/components/Avatar";
import { useFormatters } from "~/lib/format";
import { linkClass, smallButtonClass } from "~/lib/ui";
import type { action, FeedItem } from "~/routes/social";

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
  }
}

/**
 * One event of the feed (SAG-22): who, what and when, the title, and its likes. The like is a form
 * that works without JavaScript; with it, the count changes at once and the answer corrects it.
 */
export function FeedEntry({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  const { formatRelativeTime } = useFormatters();
  const fetcher = useFetcher<typeof action>();
  const what = useWhat(item);
  const name = item.mine
    ? t("feed.you")
    : (item.actor.displayName ?? item.actor.username);

  // What the server last said, then what is on its way.
  const answered = fetcher.data?.ok ? fetcher.data : null;
  const known = answered ?? { liked: item.liked, likes: item.likes };
  const sending = fetcher.formData?.get("liked");
  const liked = sending ? sending === "true" : known.liked;
  const likes = known.likes + (liked ? 1 : 0) - (known.liked ? 1 : 0);
  const failed = fetcher.state === "idle" && fetcher.data?.ok === false;

  return (
    <li className="border-border bg-surface-raised rounded-md border p-3">
      <article className="flex gap-3">
        <Avatar name={name} url={item.actor.avatarUrl} size="sm" />
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
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {item.mine ? null : (
              <fetcher.Form method="post" action="/social">
                <input type="hidden" name="activityId" value={item.id} />
                <input
                  type="hidden"
                  name="liked"
                  value={liked ? "false" : "true"}
                />
                <button
                  type="submit"
                  aria-pressed={liked}
                  className={`${smallButtonClass} aria-pressed:bg-accent aria-pressed:text-accent-fg`}
                >
                  {t("feed.like")}
                </button>
              </fetcher.Form>
            )}
            {likes > 0 || !item.mine ? (
              <span className="text-fg-muted text-sm">
                {t("feed.likes", { count: likes })}
              </span>
            ) : null}
          </div>
          {failed ? (
            <p role="status" className="text-danger-fg mt-2 text-sm">
              {t("feed.errors.likeFailed")}
            </p>
          ) : null}
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
