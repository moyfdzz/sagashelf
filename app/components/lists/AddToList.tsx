import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { StatusRegion } from "~/components/StatusRegion";
import { inputClass, linkClass, primaryButtonClass } from "~/lib/ui";

export type TitleListChoice = { id: string; title: string; has: boolean };

type Answer =
  { ok: true; result: "added" | "already" } | { ok: false; error: string };

/**
 * The button "Add to a list" of the page of a title and of the entry of the library (SAG-113): a
 * list to choose from the ones that do not have the title yet, and a button. It is a plain form that
 * works without JavaScript, where the server sends the person back here; with JavaScript the page
 * stays and the result shows in the toast. The lists that already have the title are named, so the
 * person sees where it is. A page of the session is a plain anchor (ADR-018).
 */
export function AddToList({
  mediaId,
  lists,
}: {
  mediaId: string;
  lists: readonly TitleListChoice[];
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<Answer>({ key: `add-to-list-${mediaId}` });
  const busy = fetcher.state !== "idle";
  const answer = fetcher.data;

  const free = lists.filter((list) => !list.has);
  const holding = lists.filter((list) => list.has);
  const selectId = `add-to-list-${mediaId}`;

  const message = !answer
    ? null
    : answer.ok
      ? t(`lists.add.${answer.result}`)
      : t(`lists.add.errors.${answer.error === "limit" ? "limit" : "failed"}`);

  return (
    <section aria-labelledby={`${selectId}-title`} className="mt-6">
      <h2 id={`${selectId}-title`} className="text-lg font-semibold">
        {t("lists.add.title")}
      </h2>
      <StatusRegion message={message} messageKey={answer} />

      {lists.length === 0 ? (
        <p className="mt-2">
          <a href="/lists/new" className={linkClass}>
            {t("lists.add.firstList")}
          </a>
        </p>
      ) : (
        <>
          {free.length > 0 ? (
            <fetcher.Form
              method="post"
              action="/lists/add"
              className="mt-2 flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="mediaId" value={mediaId} />
              <div className="min-w-0 grow sm:max-w-xs">
                <label htmlFor={selectId} className="text-sm font-semibold">
                  {t("lists.add.choose")}
                </label>
                <select
                  id={selectId}
                  name="listId"
                  required
                  className={inputClass}
                >
                  {free.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={busy}
                className={primaryButtonClass}
              >
                {t("lists.add.submit")}
              </button>
            </fetcher.Form>
          ) : (
            <p className="text-fg-muted mt-2">{t("lists.add.inAll")}</p>
          )}
          {holding.length > 0 ? (
            <p className="text-fg-muted mt-2 text-sm">
              {t("lists.add.inLists")}{" "}
              {holding.map((list, index) => (
                <span key={list.id}>
                  {index > 0 ? ", " : null}
                  {/* A page of the session: a plain anchor (ADR-018). */}
                  <a href={`/lists/${list.id}`} className={linkClass}>
                    {list.title}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
