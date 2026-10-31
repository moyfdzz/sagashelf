import type { SqlExecutor } from "../db/clerk-sync";
import { findSagaSyncWork, saveSagas } from "../db/sagas";
import { saveWikidata } from "../db/wikidata-store";
import type { WikidataClient } from "../providers/wikidata";
import { curatedSagas, type CuratedSaga } from "../sagas/curated";

/**
 * Items asked about in one run. The members query answers up to 400 rows, so the first run of
 * the 21 curated sagas (about 160 items) fits in one call; a longer list takes more runs.
 */
export const itemsPerRun = 300;

export type SagaSyncSummary = { sagas: number; items: number };

/** A short fingerprint of a curated entry, so a saga is saved again only when its entry changes. */
export async function hashOf(saga: CuratedSaga): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(saga));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Brings the sagas of `server/sagas/curated.ts` into the database (SAG-25, ADR-026): the sagas
 * and their members, and the year and ids of each member item from Wikidata. It never runs in the
 * request of a visitor. With nothing to do it costs one subrequest. When Wikidata fails, nothing
 * is lost: the sagas are saved first, and the items that are missing are asked for again on the
 * next run (a saga page lists only the works that are described).
 */
export async function syncSagas(
  deps: { db: SqlExecutor; wikidata: WikidataClient },
  sagas: readonly CuratedSaga[] = curatedSagas,
): Promise<SagaSyncSummary> {
  const summary: SagaSyncSummary = { sagas: 0, items: 0 };
  const hashes = new Map<string, string>();
  for (const saga of sagas) hashes.set(saga.slug, await hashOf(saga));

  const work = await findSagaSyncWork(
    deps.db,
    sagas.map((saga) => ({
      slug: saga.slug,
      hash: hashes.get(saga.slug) ?? "",
    })),
    [...new Set(sagas.flatMap((saga) => saga.members))],
  );

  const changed = sagas.filter((saga) => work.changedSlugs.includes(saga.slug));
  if (changed.length > 0) {
    await saveSagas(
      deps.db,
      changed.map((saga) => ({
        slug: saga.slug,
        titles: saga.titles,
        hash: hashes.get(saga.slug) ?? "",
        members: saga.members,
      })),
    );
    summary.sagas = changed.length;
  }

  const ask = work.missingQids.slice(0, itemsPerRun);
  if (ask.length > 0) {
    const items = await deps.wikidata.members([], ask, {
      signal: AbortSignal.timeout(25_000),
    });
    await saveWikidata(deps.db, { titles: [], items });
    summary.items = items.length;
  }
  return summary;
}
