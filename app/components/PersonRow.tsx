import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Avatar } from "~/components/Avatar";
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
      <Avatar name={shown} url={person.avatarUrl} />
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
