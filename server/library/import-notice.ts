/** The type of the notification a person gets when an import of theirs is finished (SAG-242). */
export const importFinishedType = "import.finished";

/**
 * What that notification says, from its payload, or null when it is not readable: how many titles
 * are in the library and how many could not be imported. The titles and the reasons are read on
 * the page of the import, never here.
 */
export function importFinishedNotice(payload: Record<string, unknown>) {
  const { imported, problems } = payload;
  const whole = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!whole(imported) || !whole(problems)) return null;
  return { imported, problems };
}
