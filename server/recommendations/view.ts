import type {
  GenreRecommendation,
  SagaSuggestion,
} from "../db/recommendations";
import type { Genre } from "../providers/genres";
import type { Locale } from "../providers/types";
import { mediaPath } from "../media/slug";
import { memberLabel } from "../sagas/view";

/** How many sagas, and how many works of each, the page lists. The rest is counted, not listed. */
export const sagasShown = 5;
export const worksPerSaga = 6;

/** How many of the genres of a title are said as the reason for a recommendation. */
export const becauseShown = 3;

export type GenreItem = {
  mediaId: string;
  type: GenreRecommendation["type"];
  title: string;
  year: number | null;
  href: string;
  /** The genres of the person that this title has, the ones they like most first. */
  because: Genre[];
};

/** The titles by genre as the page lists them, each with a link and the reason it was offered. */
export function viewGenreItems(
  items: readonly GenreRecommendation[],
): GenreItem[] {
  return items.map((item) => ({
    mediaId: item.mediaId,
    type: item.type,
    title: item.title,
    year: item.year,
    href: mediaPath(item.type, item.title, item.mediaId),
    because: item.because.slice(0, becauseShown),
  }));
}

export type SagaSuggestionItem = {
  qid: string;
  label: string;
  /** The format of the work, as Wikidata or the catalog says it. */
  format: string;
  year: number | null;
  /** The page of the title when the catalog holds it; otherwise the name is plain text. */
  href: string | null;
};

export type SagaSuggestionView = {
  slug: string;
  title: string;
  items: SagaSuggestionItem[];
  /** How many more works the saga has that the person lacks and that are not listed. */
  more: number;
};

/**
 * The sagas as the page lists them: the ones with the fewest works left first (the nearest to be
 * finished), then by address, at most `sagasShown`; each with its works in the order of the story,
 * at most `worksPerSaga`, named in the language of the visitor. A work with no name in either
 * language is left out: there is nothing to show.
 */
export function viewSagaSuggestions(
  suggestions: readonly SagaSuggestion[],
  locale: Locale,
): SagaSuggestionView[] {
  return suggestions
    .map((saga) => {
      const items = saga.missing.flatMap((work) => {
        const label = memberLabel(work, locale);
        return label
          ? [
              {
                qid: work.qid,
                label,
                format: work.media?.type ?? work.format,
                year: work.year,
                href: work.media
                  ? mediaPath(work.media.type, label, work.media.id)
                  : null,
              },
            ]
          : [];
      });
      const view: SagaSuggestionView = {
        slug: saga.slug,
        title: saga.titles[locale] || saga.title,
        items: items.slice(0, worksPerSaga),
        more: Math.max(0, items.length - worksPerSaga),
      };
      return { view, total: items.length };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => a.total - b.total || a.view.slug.localeCompare(b.view.slug))
    .slice(0, sagasShown)
    .map((entry) => entry.view);
}
