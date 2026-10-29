/**
 * The i18next context for the words that say what a person does with a title: books and manga
 * are read, everything else is watched. `undefined` keeps the plain key (the "watched" wording).
 */
export const readingContext = (type: string) =>
  type === "book" || type === "manga" ? "read" : undefined;
