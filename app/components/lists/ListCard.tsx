import { useTranslation } from "react-i18next";

import { linkClass } from "~/lib/ui";

export type ListSummary = {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "friends" | "private";
  items: number;
};

/**
 * One list of the person on the page of their lists (SAG-113): its name, who may see it, how many
 * titles it has and the start of its description. The link is a plain anchor: the page of a list is
 * a page of the session, and these load a whole new document (ADR-018).
 */
export function ListCard({ list }: { list: ListSummary }) {
  const { t } = useTranslation();

  return (
    <li className="border-border bg-surface-raised rounded-md border p-4">
      <p className="font-semibold break-words">
        <a href={`/lists/${list.id}`} className={linkClass}>
          {list.title}
        </a>
      </p>
      <p className="text-fg-muted mt-1 text-sm">
        {t(`lists.visibility.${list.visibility}.label`)}
        <span className="ml-2">
          {t("lists.card.items", { count: list.items })}
        </span>
      </p>
      {list.description ? (
        <p className="mt-2 break-words whitespace-pre-line">
          {list.description}
        </p>
      ) : null}
    </li>
  );
}
