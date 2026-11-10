/**
 * Makes the text of a search box literal for `LIKE`: `%`, `_` and the escape character itself are
 * plain text there, not patterns. Used with the default escape of PostgreSQL (the backslash).
 */
export const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, "\\$&");
