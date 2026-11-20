/**
 * The length of a review, for the counter of the form. A copy of `server/reviews/rules.ts`, which
 * `app/lib` cannot import; `app/routes/review-limits.test.ts` keeps both equal.
 */
export const reviewMinLength = 500;
export const reviewMaxLength = 5000;

/** The length the way the server counts it: one per code point, so an emoji counts once. */
export const reviewLength = (body: string) =>
  [...body.replace(/\r\n?/g, "\n").trim()].length;
