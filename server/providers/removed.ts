/**
 * Titles a provider (or its rights holders) asked us to stop showing. MangaDex requires it: "As we
 * do honor such requests, you must in turn honor them" (terms read 2026-10-28), and other
 * providers can ask the same. A title in this list is left out of the search results, answers
 * "not found" when opened, and its cover is not served. A key is `provider:externalId`, for
 * example `mangadex:dc332d04-d3b0-413c-a767-70f5e451b031`.
 *
 * Adding one is a change to this file and a deploy. A row of that title that is already saved
 * must be deleted too (the procedure, with its SQL, is in ADR-022). The list is empty until the
 * first request arrives.
 */
export const removedTitles: ReadonlySet<string> = new Set<string>([]);

export function isRemoved(
  provider: string,
  externalId: string,
  list: ReadonlySet<string> = removedTitles,
): boolean {
  return list.has(`${provider}:${externalId.toLowerCase()}`);
}
