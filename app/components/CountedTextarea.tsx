import { type ComponentProps, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { countCharacters, limitState } from "~/lib/notes";

type Props = Omit<ComponentProps<"textarea">, "maxLength" | "defaultValue"> & {
  id: string;
  /** The most characters the server accepts. */
  max: number;
  defaultValue?: string;
};

const noop = () => () => undefined;

/**
 * A textarea with a live "X/max" under it. It counts characters as the database does (an emoji is
 * one), which the `maxLength` of the browser does not, so that attribute is not used: a text over
 * the limit shows the count in the danger color with the number of characters over, and the
 * server still refuses to save it. The count is read with the field (it is in its description),
 * and is announced only on reaching or passing the limit, not at every key. Without JavaScript
 * there is no count, because it could not change: the hint of the field is all there is.
 */
export function CountedTextarea({
  id,
  max,
  defaultValue = "",
  "aria-describedby": describedBy,
  ...rest
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(defaultValue);
  // False on the server and while hydrating, true after: the count only exists with JavaScript.
  const live = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const count = countCharacters(text);
  const state = limitState(count, max);
  const extra = Math.max(0, count - max);
  const countId = `${id}-count`;

  return (
    <>
      <textarea
        {...rest}
        id={id}
        defaultValue={defaultValue}
        onChange={(event) => {
          setText(event.target.value);
          rest.onChange?.(event);
        }}
        aria-describedby={
          live ? [describedBy, countId].filter(Boolean).join(" ") : describedBy
        }
      />
      {live ? (
        <>
          <p
            id={countId}
            className={`mt-1 text-sm tabular-nums ${
              state === "over"
                ? "text-danger-text font-semibold"
                : state === "ok"
                  ? "text-fg-muted"
                  : "text-fg font-semibold"
            }`}
          >
            {t("library.counter.value", { count, max })}
            {state === "over" ? (
              <> {t("library.counter.over", { count: extra })}</>
            ) : null}
          </p>
          <p role="status" className="sr-only">
            {state === "full"
              ? t("library.counter.full", { max })
              : state === "over"
                ? t("library.counter.over", { count: extra })
                : ""}
          </p>
        </>
      ) : null}
    </>
  );
}
