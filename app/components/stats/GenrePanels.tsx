import { useTranslation } from "react-i18next";

import { ChartTable } from "~/components/charts/ChartTable";
import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { StatsPageData } from "~/routes/stats";
import {
  bestScoredGenres,
  minutesToDays,
  topGenresByTime,
  topGenresByTitles,
} from "~/lib/stats-view";
import { linkClass } from "~/lib/ui";
import { Panel, useStatsHelpers } from "./shared";

/** The genres (SAG-86): by time, by titles, by score and the table of all. */
export function GenrePanels({
  stats,
  type,
}: {
  stats: StatsPageData["stats"];
  type: StatsPageData["type"];
}) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const { titles, daysText, genreHref, orDash } = useStatsHelpers(type);
  const genreTime = topGenresByTime(stats.byGenre);
  const genreTitles = topGenresByTitles(stats.byGenre);
  const genreBest = bestScoredGenres(stats.byGenre);
  const withoutGenreNote =
    stats.withoutGenre > 0
      ? t("stats.genres.without", { count: stats.withoutGenre })
      : null;

  return (
    <>
      {stats.byGenre.length === 0 && withoutGenreNote ? (
        <Panel id="stats-genres" title={t("stats.genres.title")} wide>
          <p>{t("stats.genres.none")}</p>
          <p className="text-fg-muted text-sm">{withoutGenreNote}</p>
        </Panel>
      ) : null}

      {genreTime.length > 0 ? (
        <Panel
          id="stats-genre-time"
          title={t("stats.genres.time.title")}
          description={t("stats.genres.time.description")}
        >
          <RowBars
            rows={genreTime.map((entry) => ({
              key: entry.genre,
              label: `${t(`genres.${entry.genre}`)} · ${titles(entry.titles)}`,
              value: entry.minutes,
              href: genreHref(entry.genre),
            }))}
            format={daysText}
          />
        </Panel>
      ) : null}

      {genreTitles.length > 0 ? (
        <Panel
          id="stats-genre-titles"
          title={t("stats.genres.titles.title")}
          description={t("stats.genres.titles.description")}
        >
          <RowBars
            rows={genreTitles.map((entry) => ({
              key: entry.genre,
              label: t(`genres.${entry.genre}`),
              value: entry.titles,
              href: genreHref(entry.genre),
            }))}
            format={formatNumber}
          />
        </Panel>
      ) : null}

      {genreBest.length > 0 ? (
        <Panel
          id="stats-genre-best"
          title={t("stats.genres.best.title")}
          description={t("stats.genres.best.description")}
        >
          <RowBars
            rows={genreBest.map((entry) => ({
              key: entry.genre,
              label: `${t(`genres.${entry.genre}`)} · ${titles(entry.scored)}`,
              value: entry.averageScore ?? 0,
              href: genreHref(entry.genre),
            }))}
            scaleMax={10}
            format={(value) =>
              formatNumber(value, { maximumFractionDigits: 1 })
            }
          />
        </Panel>
      ) : null}

      {stats.byGenre.length > 0 ? (
        <Panel
          id="stats-genre-all"
          title={t("stats.genres.all.title")}
          description={t("stats.genres.all.description")}
          wide
        >
          <ChartTable
            wide
            summary={t("stats.showNumbers")}
            headers={[
              t("stats.genres.column.genre"),
              t("stats.titlesLabel"),
              t("stats.genres.column.days"),
              t("stats.genres.column.pages"),
              t("stats.genres.column.chapters"),
              t("stats.genres.column.volumes"),
              t("stats.genres.column.score"),
            ]}
            rows={stats.byGenre.map((entry) => [
              <a
                key={entry.genre}
                href={genreHref(entry.genre)}
                className={linkClass}
              >
                {t(`genres.${entry.genre}`)}
              </a>,
              formatNumber(entry.titles),
              orDash(minutesToDays(entry.minutes), 1),
              orDash(entry.pagesRead),
              orDash(entry.chaptersRead),
              orDash(entry.volumesRead),
              entry.averageScore === null
                ? t("stats.none")
                : formatNumber(entry.averageScore, {
                    maximumFractionDigits: 1,
                  }),
            ])}
          />
          {withoutGenreNote ? (
            <p className="text-fg-muted text-sm">{withoutGenreNote}</p>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
