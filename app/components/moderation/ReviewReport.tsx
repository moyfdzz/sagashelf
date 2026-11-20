import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  ActionButton,
  moderationPage,
} from "~/components/moderation/ActionButton";
import { useFormatters } from "~/lib/format";
import { dangerButtonClass, linkClass, secondaryButtonClass } from "~/lib/ui";

/** The reported review, as the card draws it (ADR-057). */
export type PanelReview = {
  body: string;
  spoiler: boolean;
  /** When the author was asked to mark it as a spoiler, or null. */
  spoilerRequestedAt: number | null;
  media: { title: string; href: string };
};

/**
 * The review of a report and what can be done about it: remove it, ask its author to mark it as a
 * spoiler and later see whether they did, or close the reports once they did. A review deleted
 * since the report says so, and only the actions on the person are left. Nothing is done here to
 * the review of an administrator or of the one asking (`isProtected`).
 */
export function ReviewReport({
  reportId,
  review,
  isProtected,
}: {
  reportId: string;
  review: PanelReview | null;
  isProtected: boolean;
}) {
  const { t } = useTranslation();
  const { formatPanelTime } = useFormatters();

  if (!review) {
    return (
      <p className="text-fg-muted mt-3 text-sm font-semibold">
        {t("admin.moderation.reviews.gone")}
      </p>
    );
  }

  const asked = review.spoilerRequestedAt !== null;
  return (
    <div className="mt-3 space-y-3">
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-fg-muted">
          {t("admin.moderation.reviews.of")}
        </span>
        {/* A plain link: the title page is not a page of the administration. */}
        <a href={review.media.href} className={linkClass}>
          {review.media.title}
        </a>
      </p>
      <p className="text-sm">
        {review.spoiler
          ? t("admin.moderation.reviews.marked")
          : t("admin.moderation.reviews.notMarked")}
      </p>
      {asked ? (
        <p className="text-sm font-semibold" role="note">
          {t(
            review.spoiler
              ? "admin.moderation.reviews.askedDone"
              : "admin.moderation.reviews.askedWaiting",
            { time: formatPanelTime(review.spoilerRequestedAt ?? 0) },
          )}
        </p>
      ) : null}
      {/* The moderator reads the whole text, spoilers included: that is what is judged. */}
      <blockquote className="border-border border-l-4 pl-3 break-words whitespace-pre-line">
        {review.body}
      </blockquote>

      {isProtected ? null : (
        <div className="flex flex-wrap gap-3">
          <Link
            to={`${moderationPage}?confirm=${reportId}&do=remove_review`}
            preventScrollReset
            className={`${dangerButtonClass} inline-block`}
          >
            {t("admin.moderation.reviews.remove")}
          </Link>
          {!review.spoiler && !asked ? (
            <ActionButton
              intent="ask_spoiler"
              fields={{ id: reportId }}
              className={secondaryButtonClass}
            >
              {t("admin.moderation.reviews.askSpoiler")}
            </ActionButton>
          ) : null}
          {review.spoiler && asked ? (
            <ActionButton
              intent="close_fixed"
              fields={{ id: reportId }}
              className={secondaryButtonClass}
            >
              {t("admin.moderation.reviews.closeFixed")}
            </ActionButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
