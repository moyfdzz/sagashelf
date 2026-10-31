import type { SqlExecutor } from "../db/clerk-sync";
import { findTitlesToLookUp, saveWikidata } from "../db/wikidata-store";
import type { WikidataClient } from "../providers/wikidata";
import type { WikidataItem } from "../providers/wikidata/map";

/**
 * Titles looked up in one run. The scheduled invocation shares 50 subrequests (ADR-001, ADR-007)
 * and the refresh job uses about 41 of them. This job costs 4 whatever the number of titles: the
 * list query, one lookup and one members query to Wikidata, and one save. The 20 only keeps the
 * queries short.
 */
export const wikidataBatchSize = 20;

const runTimeoutMs = 25_000;

export type WikidataSummary = {
  found: number;
  matched: number;
  unknown: number;
  items: number;
};

/** Two answers about the same item, joined: what one lacks the other fills. */
function merge(a: WikidataItem, b: WikidataItem): WikidataItem {
  return {
    qid: a.qid,
    labels: { ...a.labels, ...b.labels },
    format: a.format === "other" ? b.format : a.format,
    ids: { ...a.ids, ...b.ids },
    franchises: [...new Set([...a.franchises, ...b.franchises])],
    basedOn: [...new Set([...a.basedOn, ...b.basedOn])],
    // The members query is the one that describes an item, so its year wins.
    year: b.detailed ? b.year : (a.year ?? b.year),
    detailed: a.detailed || b.detailed,
  };
}

/**
 * Looks up the titles that were never looked up (SAG-16, ADR-025): which Wikidata item each one
 * is, and the other members of its media franchises. It never runs in the request of a visitor.
 * When Wikidata fails, nothing is saved and the same titles are tried again on the next run; a
 * title Wikidata does not know is noted and asked about again after 30 days.
 */
export async function enrichWithWikidata(
  deps: { db: SqlExecutor; wikidata: WikidataClient },
  limit: number = wikidataBatchSize,
): Promise<WikidataSummary> {
  const summary: WikidataSummary = {
    found: 0,
    matched: 0,
    unknown: 0,
    items: 0,
  };
  const candidates = await findTitlesToLookUp(deps.db, limit);
  summary.found = candidates.length;
  if (candidates.length === 0) return summary;

  const signal = AbortSignal.timeout(runTimeoutMs);
  const hits = await deps.wikidata.lookup(
    candidates.flatMap((candidate) => candidate.sources),
    { signal },
  );

  const items = new Map<string, WikidataItem>();
  const add = (item: WikidataItem) => {
    const held = items.get(item.qid);
    items.set(item.qid, held ? merge(held, item) : item);
  };
  const titles: { mediaId: string; qid: string | null }[] = [];
  for (const candidate of candidates) {
    const hit = hits.find((found) =>
      candidate.sources.some(
        (source) =>
          source.scheme === found.source.scheme &&
          source.value === found.source.value,
      ),
    );
    titles.push({ mediaId: candidate.mediaId, qid: hit?.item.qid ?? null });
    if (hit) {
      // The format of a title we hold is the one our own catalog gives it.
      add({ ...hit.item, format: candidate.type });
      summary.matched += 1;
    } else {
      summary.unknown += 1;
    }
  }

  const found = [...items.values()];
  const members = await deps.wikidata.members(
    [...new Set(found.flatMap((item) => item.franchises))],
    [...new Set(found.flatMap((item) => item.basedOn))],
    { signal },
  );
  for (const member of members) add(member);

  summary.items = items.size;
  await saveWikidata(deps.db, { titles, items: [...items.values()] });
  return summary;
}
