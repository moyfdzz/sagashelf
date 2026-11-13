import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export type PosterGridEntry = {
  href: string;
  title: string;
  score: number | null;
  poster: string | null;
  /** A line under the title, when the list has something to say about each one (SAG-23). */
  note?: string;
};

/** The titles of a profile as a grid of posters, with the title and the score under each one. */
export function PosterGrid({
  entries,
  ordered = false,
}: {
  entries: PosterGridEntry[];
  /** A ranking: drawn as an ordered list, so a screen reader says the place of each title. */
  ordered?: boolean;
}) {
  const { t } = useTranslation();
  const List = ordered ? "ol" : "ul";
  return (
    <List className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
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
          {entry.note ? (
            <span className="text-fg-muted block text-sm">{entry.note}</span>
          ) : null}
          {entry.score ? (
            <span className="text-fg-muted text-sm">
              {t("library.card.scoreShort", { score: entry.score })}
            </span>
          ) : null}
        </li>
      ))}
    </List>
  );
}
