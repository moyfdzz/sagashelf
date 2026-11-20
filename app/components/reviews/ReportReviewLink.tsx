import { useTranslation } from "react-i18next";

import { linkClass } from "~/lib/ui";

/**
 * The link to report a review (SAG-22, ADR-057), on every review that is not the viewer's own. A
 * plain link: the report page is a session page (ADR-018), and a visitor is asked to sign in.
 */
export function ReportReviewLink({ reviewId }: { reviewId: string }) {
  const { t } = useTranslation();
  return (
    <a href={`/reviews/${reviewId}/report`} className={`${linkClass} text-sm`}>
      {t("reviews.report")}
    </a>
  );
}
