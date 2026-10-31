import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { LocalizedText } from "./schema/shared";
import {
  isWikidataFormat,
  largeFranchiseSize,
  mainFormats,
  type WikidataFormat,
  type WikidataItem,
  type WikidataScheme,
} from "../providers/wikidata/map";
import type { MediaKind } from "../providers/types";

/** A title of the catalog that has not been looked up in Wikidata, with the ids to look it up by. */
export type WikidataCandidate = {
  mediaId: string;
  type: MediaKind;
  sources: { scheme: WikidataScheme; value: string }[];
};

/** How long a title Wikidata did not know waits before it is asked about again. */
export const retryAfterDays = 30;

/**
 * The titles to look up: the ones never looked up and the ones Wikidata did not know a month ago,
 * those in somebody's library first. A manga is left out until MangaDex has given its ids
 * (`cross_ids` is set), so it is not looked up with nothing to look up by.
 */
export async function findTitlesToLookUp(
  db: SqlExecutor,
  limit: number,
): Promise<WikidataCandidate[]> {
  const { rows } = await db.execute(sql`
    SELECT m.id AS media_id, m.type::text AS type, e.provider::text AS provider, e.external_id,
           m.cross_ids
    FROM media_items m
    JOIN LATERAL (
      SELECT provider, external_id FROM media_external_ids
      WHERE media_id = m.id ORDER BY created_at LIMIT 1
    ) e ON true
    LEFT JOIN media_wikidata w ON w.media_id = m.id
    WHERE m.type <> 'custom'
      AND e.provider IN ('tmdb', 'open_library', 'mangadex')
      AND (e.provider <> 'mangadex' OR m.cross_ids IS NOT NULL)
      AND (w.media_id IS NULL
           OR (w.qid IS NULL AND w.checked_at < now() - make_interval(days => ${retryAfterDays})))
    ORDER BY EXISTS (SELECT 1 FROM library_entries le WHERE le.media_id = m.id) DESC,
             w.checked_at NULLS FIRST, m.id
    LIMIT ${limit}
  `);
  return rows.map((row) => {
    const provider = String(row.provider);
    const externalId = String(row.external_id);
    const crossIds = (row.cross_ids as Record<string, string> | null) ?? {};
    const sources: WikidataCandidate["sources"] = [];
    if (provider === "tmdb") {
      const [kind, id] = externalId.split("/");
      if (id && (kind === "movie" || kind === "tv")) {
        sources.push({
          scheme: kind === "movie" ? "tmdb_movie" : "tmdb_tv",
          value: id,
        });
      }
    } else if (provider === "open_library") {
      sources.push({ scheme: "open_library", value: externalId });
    } else {
      if (crossIds.mal)
        sources.push({ scheme: "mal_manga", value: crossIds.mal });
      if (crossIds.anilist) {
        sources.push({ scheme: "anilist_manga", value: crossIds.anilist });
      }
    }
    return {
      mediaId: String(row.media_id),
      type: row.type as MediaKind,
      sources,
    };
  });
}

export type WikidataSave = {
  /** What was found for each title: its item, or null when Wikidata does not know it. */
  titles: { mediaId: string; qid: string | null }[];
  items: readonly WikidataItem[];
};

/**
 * Saves the result of a run in one statement, so it costs one subrequest and is kept whole or not
 * at all: the items (a label or an id Wikidata did not send this time never erases one we hold),
 * their links, and that each title was looked up.
 */
export async function saveWikidata(
  db: SqlExecutor,
  save: WikidataSave,
): Promise<void> {
  if (save.titles.length === 0 && save.items.length === 0) return;
  const items = JSON.stringify(
    save.items.map((item) => ({
      qid: item.qid,
      labels: item.labels,
      format: item.format,
      ids: item.ids,
      year: item.year ?? null,
      detailed: item.detailed ?? false,
    })),
  );
  const links = JSON.stringify(
    save.items.flatMap((item) => [
      ...item.franchises.map((to) => ({
        from: item.qid,
        to,
        relation: "franchise",
      })),
      ...item.basedOn.map((to) => ({
        from: item.qid,
        to,
        relation: "based_on",
      })),
    ]),
  );
  const titles = JSON.stringify(
    save.titles.map((title) => ({ media_id: title.mediaId, qid: title.qid })),
  );
  await db.execute(sql`
    WITH saved_items AS (
      INSERT INTO wikidata_items (qid, labels, format, ids, year, details_at)
      SELECT qid, labels, format, ids, year, CASE WHEN detailed THEN now() END
      FROM jsonb_to_recordset(${items}::jsonb)
        AS x(qid text, labels jsonb, format text, ids jsonb, year int, detailed boolean)
      ON CONFLICT (qid) DO UPDATE SET
        labels = wikidata_items.labels || EXCLUDED.labels,
        -- A title we looked up is saved with the format "other" until a members query names it,
        -- which never replaces a format that is already known.
        format = CASE WHEN EXCLUDED.format = 'other' THEN wikidata_items.format
                      ELSE EXCLUDED.format END,
        ids = wikidata_items.ids || EXCLUDED.ids,
        -- Only the members query says the year, and its answer replaces an older one.
        year = CASE WHEN EXCLUDED.details_at IS NOT NULL THEN EXCLUDED.year
                    ELSE wikidata_items.year END,
        details_at = coalesce(EXCLUDED.details_at, wikidata_items.details_at),
        updated_at = now()
      RETURNING 1
    ),
    saved_links AS (
      INSERT INTO wikidata_links (from_qid, to_qid, relation)
      SELECT DISTINCT "from", "to", relation
      FROM jsonb_to_recordset(${links}::jsonb)
        AS x("from" text, "to" text, relation text)
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    INSERT INTO media_wikidata (media_id, qid, checked_at)
    SELECT media_id, qid, now()
    FROM jsonb_to_recordset(${titles}::jsonb) AS x(media_id uuid, qid text)
    ON CONFLICT (media_id) DO UPDATE SET qid = EXCLUDED.qid, checked_at = now()
  `);
}

/**
 * Whether the title `m` (`media_items`) is the item `i` (`wikidata_items`): it was looked up as
 * that item, or it has the same id in TMDB or Open Library, or the same MyAnimeList or AniList id
 * as a manga. The aliases are fixed because the fragment is written into other queries.
 */
export const mediaMatchesItem = sql`(
  m.id IN (SELECT media_id FROM media_wikidata WHERE qid = i.qid)
  OR m.id IN (
    SELECT media_id FROM media_external_ids
    WHERE (provider = 'tmdb' AND external_id IN (
             'movie/' || (i.ids->>'tmdb_movie'), 'tv/' || (i.ids->>'tmdb_tv')))
       OR (provider = 'open_library' AND external_id = i.ids->>'open_library')
  )
  OR m.cross_ids @> jsonb_build_object('mal', i.ids->>'mal_manga')
  OR m.cross_ids @> jsonb_build_object('anilist', i.ids->>'anilist_manga')
)`;

/** One thing related to a title, as the page lists it. */
export type RelatedFormat = {
  qid: string;
  format: WikidataFormat;
  labels: LocalizedText;
  /** The title of our catalog this is, when we hold it. */
  media: {
    id: string;
    type: MediaKind;
    title: string;
    titles: LocalizedText;
  } | null;
};

/** The most related items a page lists. */
export const relatedLimit = 30;

/**
 * What Wikidata says is the same story as a title: the other members of its media franchises and
 * the works it is based on or that are based on it. Each one carries the title of our catalog that
 * it matches (by the item it was looked up as, or by an id in TMDB, Open Library or MangaDex).
 */
export async function getRelatedFormats(
  db: SqlExecutor,
  mediaId: string,
): Promise<RelatedFormat[]> {
  const { rows } = await db.execute(sql`
    WITH me AS (
      SELECT qid FROM media_wikidata WHERE media_id = ${mediaId}::uuid AND qid IS NOT NULL
    ),
    franchises AS (
      SELECT l.to_qid AS qid FROM wikidata_links l JOIN me ON l.from_qid = me.qid
      WHERE l.relation = 'franchise'
    ),
    related AS (
      -- A large franchise lists toys, spoofs and games next to its works: only the main formats
      -- stay, whatever an older run saved (SAG-94).
      SELECT m.from_qid AS qid FROM (
        SELECT l.from_qid, count(*) OVER (PARTITION BY l.to_qid) AS size
        FROM wikidata_links l JOIN franchises f ON l.to_qid = f.qid
        WHERE l.relation = 'franchise'
      ) m
      JOIN wikidata_items mi ON mi.qid = m.from_qid
      WHERE m.size <= ${largeFranchiseSize}
         OR mi.format IN (${sql.join(
           mainFormats.map((format) => sql`${format}`),
           sql`, `,
         )})
      UNION
      SELECT l.to_qid FROM wikidata_links l JOIN me ON l.from_qid = me.qid
      WHERE l.relation = 'based_on'
      UNION
      SELECT l.from_qid FROM wikidata_links l JOIN me ON l.to_qid = me.qid
      WHERE l.relation = 'based_on'
    )
    SELECT i.qid, i.format, i.labels, matched.id AS media_id, matched.type AS media_type,
           matched.title AS media_title, matched.titles AS media_titles
    FROM related r
    JOIN wikidata_items i ON i.qid = r.qid
    LEFT JOIN LATERAL (
      SELECT m.id, m.type::text AS type, m.title, m.titles
      FROM media_items m
      WHERE m.type <> 'custom' AND ${mediaMatchesItem}
      ORDER BY m.id
      LIMIT 1
    ) matched ON true
    WHERE i.qid NOT IN (SELECT qid FROM me)
      AND i.format <> 'franchise'
      AND (matched.id IS NULL OR matched.id <> ${mediaId}::uuid)
    -- The main works first, the oldest first: the same ones on every visit.
    ORDER BY array_position(
               ARRAY['anime', 'movie', 'series', 'manga', 'book', 'game', 'other']::text[], i.format),
             i.year NULLS LAST, coalesce(i.labels->>'en', i.labels->>'es', i.qid), i.qid
    LIMIT ${relatedLimit}
  `);
  return rows.map((row) => ({
    qid: String(row.qid),
    format: isWikidataFormat(row.format) ? row.format : "other",
    labels: (row.labels as LocalizedText | null) ?? {},
    media: row.media_id
      ? {
          id: String(row.media_id),
          type: row.media_type as MediaKind,
          title: String(row.media_title),
          titles: (row.media_titles as LocalizedText | null) ?? {},
        }
      : null,
  }));
}
