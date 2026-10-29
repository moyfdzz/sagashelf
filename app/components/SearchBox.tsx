import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useFetcher } from "react-router";

import type { loader } from "~/routes/search";

const suggestionDelayMs = 350;
const suggestionLimit = 5;
const minLength = 2;

type Props = {
  initialQuery: string;
  type: string | undefined;
};

/**
 * The search field. Without JavaScript it is a plain form that sends `q` and `type` to the
 * results page. With it, after a pause in typing, it asks the same page for suggestions and shows
 * the first few titles in a list: the arrow keys move through them, Enter picks one and searches
 * for it, Escape closes the list. This is the "combobox with a list" pattern.
 */
export function SearchBox({ initialQuery, type }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestions = useFetcher<typeof loader>();
  const { load } = suggestions;

  const trimmed = value.trim();

  useEffect(() => {
    if ([...trimmed].length < minLength) return;
    // `suggest` tells the page this is only a list to pick from, not a page to show.
    const params = new URLSearchParams({ q: trimmed, suggest: "1" });
    if (type) params.set("type", type);
    const timer = setTimeout(
      () => void load(`/search?${params}`),
      suggestionDelayMs,
    );
    return () => clearTimeout(timer);
  }, [trimmed, type, load]);

  // Only the suggestions for what is in the field now; an older answer is not shown.
  const shown =
    open && suggestions.data?.q === trimmed
      ? suggestions.data.results.slice(0, suggestionLimit)
      : [];
  const listOpen = shown.length > 0;

  function choose(title: string) {
    setValue(title);
    setOpen(false);
    setActive(-1);
    // Let the field show the title before the form reads it.
    queueMicrotask(() => form.current?.requestSubmit());
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown" && listOpen) {
      event.preventDefault();
      setActive((index) => (index + 1) % shown.length);
    } else if (event.key === "ArrowUp" && listOpen) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? shown.length - 1 : index - 1));
    } else if (event.key === "Enter" && listOpen && active >= 0) {
      event.preventDefault();
      choose(shown[active].title);
    }
  }

  return (
    <Form
      ref={form}
      method="get"
      action="/search"
      role="search"
      className="relative mt-6 flex gap-2"
    >
      {type ? <input type="hidden" name="type" value={type} /> : null}
      <div className="relative flex-1">
        <label htmlFor={`${listId}-input`} className="sr-only">
          {t("search.inputLabel")}
        </label>
        <input
          ref={input}
          id={`${listId}-input`}
          name="q"
          type="search"
          role="combobox"
          value={value}
          autoComplete="off"
          maxLength={100}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={
            listOpen && active >= 0 ? `${listId}-${active}` : undefined
          }
          placeholder={t("search.placeholder")}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className="bg-surface-raised border-input-edge placeholder:text-fg-muted focus-visible:outline-accent w-full rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={t("search.suggestions")}
          hidden={!listOpen}
          className="bg-surface-raised border-border absolute inset-x-0 top-full z-40 mt-1 rounded-md border p-1 shadow-lg"
        >
          {shown.map((result, index) => (
            // The keyboard is handled by the field (arrows and Enter), as the combobox pattern
            // asks; the options only need to react to the mouse.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={`${result.provider}:${result.externalId}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // The field keeps its focus when a suggestion is clicked.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(result.title)}
              className={`cursor-pointer rounded-md px-3 py-2 ${
                index === active ? "bg-fg/10" : ""
              }`}
            >
              {result.title}
              {result.year ? (
                <span className="text-fg-muted">
                  {" "}
                  {t("search.year", { year: result.year })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="submit"
        aria-label={t("search.submit")}
        className="bg-accent text-accent-fg focus-visible:outline-accent rounded-md px-4 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Search aria-hidden="true" className="size-5" />
      </button>
    </Form>
  );
}
