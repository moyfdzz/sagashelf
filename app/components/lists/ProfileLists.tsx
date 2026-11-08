import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { linkClass } from "~/lib/ui";

export type ProfileListSummary = {
  id: string;
  title: string;
  description: string | null;
  items: number;
};

/**
 * The lists of a person on their profile (SAG-113, ADR-045): only the ones the viewer may see,
 * each with its name, how many titles it has and the start of its description. The links are
 * links of the router: `/u/...` is not a page of the session (ADR-018).
 */
export function ProfileLists({
  lists,
  username,
  name,
}: {
  lists: readonly ProfileListSummary[];
  username: string;
  name: string;
}) {
  const { t } = useTranslation();
  const base = `/u/${encodeURIComponent(username)}/lists`;

  return (
    <section aria-labelledby="section-lists" className="mt-8">
      <h2 id="section-lists" className="text-xl font-bold">
        {t("profile.lists.title")}
      </h2>
      <ul
        aria-label={t("profile.lists.label", { name })}
        className="mt-3 space-y-3"
      >
        {lists.map((list) => (
          <li
            key={list.id}
            className="border-border bg-surface-raised rounded-md border p-4"
          >
            <p className="font-semibold break-words">
              <Link to={`${base}/${list.id}`} className={linkClass}>
                {list.title}
              </Link>
            </p>
            <p className="text-fg-muted mt-1 text-sm">
              {t("lists.card.items", { count: list.items })}
            </p>
            {list.description ? (
              <p className="mt-2 break-words whitespace-pre-line">
                {list.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
