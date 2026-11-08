import { useTranslation } from "react-i18next";

import { CountedTextarea } from "~/components/CountedTextarea";
import { inputClass } from "~/lib/ui";

type Level = "public" | "friends" | "private";

export type ListValues = {
  title: string;
  description: string;
  visibility: string;
};

/**
 * The three fields of a list, for the form that creates one and the form that changes one
 * (SAG-113): the name, a description and who may see it. The limits and the levels come from the
 * route, which knows the server's rules; `error` marks the field that was refused.
 */
export function ListFields({
  idPrefix,
  values,
  error,
  levels,
  maxTitle,
  maxDescription,
}: {
  /** Makes the ids of the fields different when two forms are on one page. */
  idPrefix: string;
  values: ListValues;
  error: "invalid_request" | "duplicate" | "limit" | "not_found" | null;
  levels: readonly Level[];
  maxTitle: number;
  maxDescription: number;
}) {
  const { t } = useTranslation();
  const chosen = levels.find((level) => level === values.visibility);
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <>
      <div>
        <label htmlFor={titleId} className="font-semibold">
          {t("lists.fields.title")}
        </label>
        <input
          id={titleId}
          name="title"
          required
          autoComplete="off"
          defaultValue={values.title}
          aria-describedby={`${titleId}-hint`}
          aria-invalid={
            error === "duplicate" || error === "invalid_request"
              ? true
              : undefined
          }
          className={inputClass}
        />
        <p id={`${titleId}-hint`} className="text-fg-muted mt-1 text-sm">
          {t("lists.fields.titleHint", { max: maxTitle })}
        </p>
      </div>

      <div>
        <label htmlFor={descriptionId} className="font-semibold">
          {t("lists.fields.description")}
        </label>
        <CountedTextarea
          id={descriptionId}
          name="description"
          rows={3}
          max={maxDescription}
          defaultValue={values.description}
          aria-describedby={`${descriptionId}-hint`}
          className={inputClass}
        />
        <p id={`${descriptionId}-hint`} className="text-fg-muted mt-1 text-sm">
          {t("lists.fields.descriptionHint", { max: maxDescription })}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-semibold">
          {t("lists.fields.visibility")}
        </legend>
        {levels.map((level) => (
          <label key={level} className="flex items-start gap-2">
            <input
              type="radio"
              name="visibility"
              value={level}
              required
              // A list is private until the person says otherwise.
              defaultChecked={chosen ? chosen === level : level === "private"}
              className="mt-1 shrink-0"
            />
            <span className="font-semibold">
              {t(`lists.visibility.${level}.label`)}
              <span className="text-fg-muted block text-sm font-normal">
                {t(`lists.visibility.${level}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </>
  );
}
