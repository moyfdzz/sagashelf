import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { smallButtonClass } from "~/lib/ui";
import type { action } from "~/routes/social";

/**
 * The like of an event (SAG-22): of the feed, or of a review on a title page (ADR-056). A form that
 * works without JavaScript and posts to `action` (the page it is on); with JavaScript, the count
 * changes at once and the answer corrects it. The author of the event sees only the count.
 */
export function LikeButton({
  activityId,
  likes: likesRead,
  liked: likedRead,
  mine,
  action: path,
}: {
  activityId: string;
  likes: number;
  liked: boolean;
  mine: boolean;
  action: string;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();

  // What the server last said, then what is on its way. Taking a like back from an event that is
  // hidden now answers no count (null): the page then counts the others it already knew.
  const answered = fetcher.data?.ok ? fetcher.data : null;
  const known = answered
    ? {
        liked: answered.liked,
        likes: answered.likes ?? Math.max(0, likesRead - (likedRead ? 1 : 0)),
      }
    : { liked: likedRead, likes: likesRead };
  const sending = fetcher.formData?.get("liked");
  const liked = sending ? sending === "true" : known.liked;
  const likes = known.likes + (liked ? 1 : 0) - (known.liked ? 1 : 0);
  const refused =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.error
      : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {mine ? null : (
          <fetcher.Form
            method="post"
            action={path}
            // A second press while the first is on its way would send the opposite, and the
            // server could apply the two in either order.
            onSubmit={(event) => {
              if (fetcher.state !== "idle") event.preventDefault();
            }}
          >
            <input type="hidden" name="activityId" value={activityId} />
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
        {likes > 0 || !mine ? (
          <span className="text-fg-muted text-sm">
            {t("feed.likes", { count: likes })}
          </span>
        ) : null}
      </div>
      {refused ? (
        <p role="status" className="text-danger-fg mt-2 text-sm">
          {refused === "rate_limited"
            ? t("feed.errors.rateLimited")
            : t("feed.errors.likeFailed")}
        </p>
      ) : null}
    </>
  );
}
