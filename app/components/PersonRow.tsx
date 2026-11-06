import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { linkClass } from "~/lib/ui";

/** One person of a list: the picture or the first letter, the name and a link to the profile. */
export function PersonRow({
  person,
}: {
  person: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}) {
  const { t } = useTranslation();
  const shown = person.displayName ?? person.username;
  return (
    <li className="border-border bg-surface-raised flex items-center gap-3 rounded-md border p-3">
      {person.avatarUrl ? (
        // The name is written next to it, so a screen reader skips the picture.
        <span aria-hidden="true" className="shrink-0">
          <img
            src={person.avatarUrl}
            alt={t("profile.avatarAlt", { name: shown })}
            width={48}
            height={48}
            loading="lazy"
            className="size-12 rounded-full object-cover"
          />
        </span>
      ) : (
        <div
          aria-hidden="true"
          className="bg-accent text-accent-fg flex size-12 shrink-0 items-center justify-center rounded-full font-bold"
        >
          {shown.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <Link
          to={`/u/${encodeURIComponent(person.username)}`}
          className={`${linkClass} break-words`}
        >
          {shown}
        </Link>
        <p className="text-fg-muted text-sm break-words">
          {t("profile.handle", { username: person.username })}
        </p>
      </div>
    </li>
  );
}
