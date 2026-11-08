import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import {
  inputClass,
  largeIconButtonClass,
  linkClass,
  secondaryButtonClass,
} from "~/lib/ui";

/**
 * The kind and the address are null for a title with no page of its own (one the person made for
 * themselves): it is drawn as plain text with no kind beside it.
 */
export type ListTitle = {
  mediaId: string;
  title: string;
  href: string | null;
  type: "anime" | "movie" | "series" | "book" | "manga" | null;
  year: number | null;
  note: string | null;
};

/**
 * The titles of one list of the person (SAG-113): in the order they chose, each with buttons to
 * take it out and to move it up and down, and a note. Every control is a plain form that posts to
 * the page of the list and works without JavaScript; each button names the title it is about, since
 * the page has many of them and an icon says nothing to a screen reader. The first title has no
 * "up" and the last has no "down": the button is off, not hidden, so the rows keep their shape.
 */
export function ListTitles({
  titles,
  maxNote,
}: {
  titles: readonly ListTitle[];
  maxNote: number;
}) {
  const { t } = useTranslation();

  return (
    <ol className="mt-4 space-y-3">
      {titles.map((item, index) => (
        <li
          key={item.mediaId}
          className="border-border bg-surface-raised rounded-md border p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold break-words">
                {item.href ? (
                  <Link to={item.href} className={linkClass}>
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}
              </p>
              <p className="text-fg-muted mt-1 text-sm">
                {item.type ? t(`media.kinds.${item.type}`) : null}
                {item.year ? (
                  <span className={item.type ? "ml-2" : undefined}>
                    {item.year}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Form method="post" reloadDocument>
                <input type="hidden" name="intent" value="move_item" />
                <input type="hidden" name="mediaId" value={item.mediaId} />
                <input type="hidden" name="direction" value="up" />
                <button
                  type="submit"
                  disabled={index === 0}
                  aria-label={t("lists.titles.up", { name: item.title })}
                  title={t("lists.titles.up", { name: item.title })}
                  className={largeIconButtonClass}
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </button>
              </Form>
              <Form method="post" reloadDocument>
                <input type="hidden" name="intent" value="move_item" />
                <input type="hidden" name="mediaId" value={item.mediaId} />
                <input type="hidden" name="direction" value="down" />
                <button
                  type="submit"
                  disabled={index === titles.length - 1}
                  aria-label={t("lists.titles.down", { name: item.title })}
                  title={t("lists.titles.down", { name: item.title })}
                  className={largeIconButtonClass}
                >
                  <ArrowDown aria-hidden="true" className="size-4" />
                </button>
              </Form>
              <Form method="post" reloadDocument>
                <input type="hidden" name="intent" value="remove_item" />
                <input type="hidden" name="mediaId" value={item.mediaId} />
                <button
                  type="submit"
                  aria-label={t("lists.titles.remove", { name: item.title })}
                  title={t("lists.titles.remove", { name: item.title })}
                  className={largeIconButtonClass}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </Form>
            </div>
          </div>

          <Form method="post" reloadDocument className="mt-3">
            <input type="hidden" name="intent" value="note_item" />
            <input type="hidden" name="mediaId" value={item.mediaId} />
            <label
              htmlFor={`note-${item.mediaId}`}
              className="text-sm font-semibold"
            >
              {t("lists.titles.note", { name: item.title })}
            </label>
            <textarea
              id={`note-${item.mediaId}`}
              name="note"
              rows={2}
              maxLength={maxNote}
              defaultValue={item.note ?? ""}
              className={inputClass}
            />
            <button type="submit" className={`${secondaryButtonClass} mt-2`}>
              {t("lists.titles.saveNote")}
            </button>
          </Form>
        </li>
      ))}
    </ol>
  );
}
