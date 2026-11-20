import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import {
  reviewLength,
  reviewMaxLength,
  reviewMinLength,
} from "~/lib/review-limits";
import { dangerButtonClass, inputClass, primaryButtonClass } from "~/lib/ui";
import type {
  ReviewError,
  ReviewPageData,
  SentReview,
} from "~/routes/library.$mediaId.review";

const levels = ["public", "friends", "private"] as const;
type Level = (typeof levels)[number];

const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** The error of the form, in the words of the page. */
function useErrorText(error: ReviewError | null): string | null {
  const { t } = useTranslation();
  if (!error) return null;
  return t(`reviews.errors.${error}`, {
    min: reviewMinLength,
    max: reviewMaxLength,
  });
}

/**
 * The form of a review (SAG-22, ADR-053): the text with a counter, the spoiler mark, who may see
 * it (with a warning when the library entry is more private), and the score of the entry. A plain
 * document form: it works without JavaScript, and a saved review goes to the title page.
 */
export function ReviewForm({
  data,
  error,
  sent,
}: {
  data: ReviewPageData;
  error: ReviewError | null;
  sent: SentReview | null;
}) {
  const { t } = useTranslation();
  // What was sent and refused comes first, so the person never loses what they wrote.
  const start = sent ?? {
    body: data.review?.body ?? "",
    spoiler: data.review?.spoiler ?? false,
    visibility: data.defaultVisibility,
    score: data.entry.score,
  };
  const [length, setLength] = useState(reviewLength(start.body));
  const [level, setLevel] = useState<Level>(start.visibility);
  const errorText = useErrorText(error);
  // A public review tells that the person has the title, even when the entry is not public.
  const entryStricter =
    levels.indexOf(data.entry.visibility) > levels.indexOf(level);

  return (
    <>
      {errorText ? (
        <p role="alert" className="text-danger-fg mt-4 font-semibold">
          {errorText}
        </p>
      ) : null}
      {data.privateProfile ? (
        <p className="text-fg-muted mt-4">{t("reviews.form.privateProfile")}</p>
      ) : data.held ? (
        <p className="text-fg-muted mt-4">{t("reviews.form.held")}</p>
      ) : null}

      <Form method="post" reloadDocument className="mt-6 space-y-5">
        <input type="hidden" name="intent" value="save" />
        <div>
          <label htmlFor="review-body" className="font-semibold">
            {t("reviews.form.body")}
          </label>
          <p id="review-body-hint" className="text-fg-muted text-sm">
            {t("reviews.form.bodyHint", {
              min: reviewMinLength,
              max: reviewMaxLength,
            })}
          </p>
          <textarea
            id="review-body"
            name="body"
            required
            rows={12}
            defaultValue={start.body}
            aria-describedby="review-body-hint review-body-count"
            onChange={(event) => setLength(reviewLength(event.target.value))}
            className={`${inputClass} mt-1 w-full`}
          />
          <p
            id="review-body-count"
            className={`text-sm ${
              length < reviewMinLength || length > reviewMaxLength
                ? "text-fg-muted"
                : "text-fg"
            }`}
          >
            {t("reviews.form.count", { count: length, max: reviewMaxLength })}
          </p>
        </div>

        <div className="flex items-start gap-2">
          <input
            id="review-spoiler"
            type="checkbox"
            name="spoiler"
            defaultChecked={start.spoiler}
            className="mt-3 size-4"
          />
          <label htmlFor="review-spoiler" className="inline-block py-2">
            {t("reviews.form.spoiler")}
          </label>
        </div>

        <div>
          <label htmlFor="review-visibility" className="font-semibold">
            {t("reviews.form.visibility")}
          </label>
          <select
            id="review-visibility"
            name="visibility"
            value={level}
            onChange={(event) => setLevel(event.target.value as Level)}
            aria-describedby={
              entryStricter ? "review-level-warning" : undefined
            }
            className={`${inputClass} mt-1 block`}
          >
            {levels.map((one) => (
              <option key={one} value={one}>
                {t(`reviews.form.levels.${one}`)}
              </option>
            ))}
          </select>
          {entryStricter ? (
            <p id="review-level-warning" className="text-fg-muted mt-1 text-sm">
              {t("reviews.form.entryStricter")}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="review-score" className="font-semibold">
            {t("reviews.form.score")}
          </label>
          <p id="review-score-hint" className="text-fg-muted text-sm">
            {t("reviews.form.scoreHint")}
          </p>
          <select
            id="review-score"
            name="score"
            defaultValue={start.score === null ? "" : String(start.score)}
            aria-describedby="review-score-hint"
            className={`${inputClass} mt-1 block`}
          >
            <option value="">{t("reviews.form.noScore")}</option>
            {scores.map((score) => (
              <option key={score} value={String(score)}>
                {String(score)}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className={primaryButtonClass}>
          {data.review ? t("reviews.form.saveEdit") : t("reviews.form.publish")}
        </button>
      </Form>

      {data.review ? (
        <details className="border-border mt-8 rounded-md border">
          <summary className="cursor-pointer px-4 py-3 font-semibold">
            {t("reviews.form.delete.summary")}
          </summary>
          <Form
            method="post"
            reloadDocument
            className="border-border space-y-3 border-t p-4"
          >
            <input type="hidden" name="intent" value="delete" />
            <p>{t("reviews.form.delete.warning")}</p>
            <button type="submit" className={dangerButtonClass}>
              {t("reviews.form.delete.confirm")}
            </button>
          </Form>
        </details>
      ) : null}
    </>
  );
}
