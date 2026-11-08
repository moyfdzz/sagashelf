import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PosterGrid, type PosterGridEntry } from "~/components/PosterGrid";
import { linkClass } from "~/lib/ui";

/** One section of the library on a profile (SAG-107): its titles and a link to all of them. */
export type ProfileSectionData = {
  status: "in_progress" | "planned" | "completed";
  total: number;
  entries: PosterGridEntry[];
};

export function ProfileSection({
  section,
  profilePath,
}: {
  section: ProfileSectionData;
  profilePath: string;
}) {
  const { t } = useTranslation();
  const status = section.status;
  const titleId = `section-${status}`;
  return (
    <section aria-labelledby={titleId} className="mt-8">
      <h2 id={titleId} className="text-xl font-bold">
        {t(`profile.sections.${status}`)}
      </h2>
      {section.total > section.entries.length ? (
        <p className="text-fg-muted text-sm">
          {t("profile.sections.shown", {
            shown: section.entries.length,
            total: section.total,
          })}{" "}
          <Link
            to={`${profilePath}/library/${status}`}
            aria-label={t("profile.sections.seeAllLabel", {
              section: t(`profile.sections.${status}`),
            })}
            className={linkClass}
          >
            {t("profile.sections.seeAll")}
          </Link>
        </p>
      ) : null}
      <PosterGrid entries={section.entries} />
    </section>
  );
}
