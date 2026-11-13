/**
 * The small rules the statistics of the administration (SAG-26) share, written once: a day is a
 * whole day of UTC, and a number that comes back from the database may be text, so it is read
 * with one rule.
 */

/** The date of a moment in UTC, `YYYY-MM-DD`. */
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/** The same moment some days later (earlier, when negative). */
export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 86_400_000);

/** A number the client hands over as a number or as text; anything that is not one is zero. */
export const toCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A `YYYY-MM-DD` date, from a text or a `Date` at midnight UTC; null when it is neither. */
export function readDay(value: unknown): string | null {
  const text = value instanceof Date ? utcDay(value) : String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}
