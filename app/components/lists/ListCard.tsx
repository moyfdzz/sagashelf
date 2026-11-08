import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { dangerIconButtonClass, iconButtonClass, linkClass } from "~/lib/ui";

export type ListSummary = {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "friends" | "private";
  items: number;
};

/**
 * One list of the person on the page of their lists (SAG-113): its name, who may see it, how many
 * titles it has and the start of its description, with two buttons that are only an icon: change
 * it, and delete it. The links to the page of the list are plain anchors: that is a page of the
 * session, and these load a whole new document (ADR-018). Delete is a link of the router to the
 * address that asks first, so the modal opens without loading the page again. Both say which list
 * they are about, since there are many on the page and an icon says nothing to a screen reader.
 */
export function ListCard({ list }: { list: ListSummary }) {
  const { t } = useTranslation();
  const edit = t("lists.card.edit", { name: list.title });
  const remove = t("lists.card.delete", { name: list.title });

  return (
    <li className="border-border bg-surface-raised flex items-start justify-between gap-3 rounded-md border p-4">
      <div className="min-w-0">
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
      </div>
      <div className="flex shrink-0 gap-2">
        <a
          href={`/lists/${list.id}`}
          aria-label={edit}
          title={edit}
          className={iconButtonClass}
        >
          <Pencil aria-hidden="true" className="size-4" />
        </a>
        <Link
          to={`/lists?confirm=${list.id}`}
          preventScrollReset
          aria-label={remove}
          title={remove}
          className={dangerIconButtonClass}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </li>
  );
}
