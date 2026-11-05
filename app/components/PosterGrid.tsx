import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export type PosterGridEntry = {
  href: string;
  title: string;
  score: number | null;
  poster: string | null;
};

/** The titles of a profile as a grid of posters, with the title and the score under each one. */
export function PosterGrid({ entries }: { entries: PosterGridEntry[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {entries.map((entry) => (
        <li key={entry.href}>
          <Link to={entry.href} className="block">
            {entry.poster ? (
              // The title is written under it, so a screen reader skips the picture.
              <span aria-hidden="true" className="block">
                <img
                  src={entry.poster}
                  alt={t("media.posterAlt", { title: entry.title })}
                  width={185}
                  height={278}
                  loading="lazy"
                  className="border-border aspect-[2/3] w-full rounded-md border object-cover"
                />
              </span>
            ) : (
              <div
                aria-hidden="true"
                className="bg-border aspect-[2/3] w-full rounded-md"
              />
            )}
            <span className="mt-1 block text-sm font-semibold break-words">
              {entry.title}
            </span>
          </Link>
          {entry.score ? (
            <span className="text-fg-muted text-sm">
              {t("library.card.scoreShort", { score: entry.score })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
