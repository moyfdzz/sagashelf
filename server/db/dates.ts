/**
 * A timestamp column as the database client hands it over: a `Date` from the `pg` driver of the
 * tests, and a string from the HTTP client of the Worker. Kept as it is when it is already a
 * `Date`, so the milliseconds are not lost on the way through a string (SAG-119).
 */
export const asDate = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));
