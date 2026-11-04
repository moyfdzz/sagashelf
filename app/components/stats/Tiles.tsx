import { useTranslation } from "react-i18next";

import { useFormatters } from "~/lib/format";
import type { StatsPageData } from "~/routes/stats";
import { minutesToDays } from "~/lib/stats-view";

const videoTypes = ["movie", "series", "anime"];
const episodeTypes = ["series", "anime"];

/** The big numbers at the top of the page, and the note about the runtimes. */
export function Tiles({
  stats,
  type,
}: {
  stats: StatsPageData["stats"];
  type: StatsPageData["type"];
}) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const days = (minutes: number) =>
    minutes === 0 && stats.unknownRuntime > 0
      ? t("stats.none")
      : formatNumber(minutesToDays(minutes), { maximumFractionDigits: 1 });
  // A tab of one type leaves out what that type has no use for: episodes and days are for video,
  // and only series and anime have episodes.
  const showVideo = !type || videoTypes.includes(type);
  const showEpisodes = !type || episodeTypes.includes(type);
  const tiles: [string, string][] = [
    [t("stats.tiles.completed"), formatNumber(stats.completed)],
    ...(showEpisodes
      ? [[t("stats.tiles.episodes"), formatNumber(stats.episodesWatched)]]
      : []),
    ...(showVideo
      ? [
          [t("stats.tiles.daysWatched"), days(stats.minutesWatched)],
          [t("stats.tiles.daysPlanned"), days(stats.minutesPlanned)],
        ]
      : []),
    [
      t("stats.tiles.averageScore"),
      stats.averageScore === null
        ? t("stats.none")
        : formatNumber(stats.averageScore, { maximumFractionDigits: 1 }),
    ],
    [t("stats.tiles.rewatches"), formatNumber(stats.rewatches)],
  ] as [string, string][];
  if (stats.pagesRead > 0) {
    tiles.push([t("stats.tiles.pages"), formatNumber(stats.pagesRead)]);
  }
  if (stats.chaptersRead > 0) {
    tiles.push([t("stats.tiles.chapters"), formatNumber(stats.chaptersRead)]);
  }
  if (stats.volumesRead > 0) {
    tiles.push([t("stats.tiles.volumes"), formatNumber(stats.volumesRead)]);
  }

  const runtimeNote = !showVideo
    ? null
    : stats.unknownRuntime > 0
      ? `${t("stats.runtime.note")} ${t("stats.runtime.missing", { count: stats.unknownRuntime })}`
      : t("stats.runtime.note");

  return (
    <section aria-label={t("stats.tiles.label")} className="mt-8">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div
            key={label}
            className="border-border bg-surface-raised rounded-md border p-4"
          >
            <dd className="text-3xl font-semibold">{value}</dd>
            <dt className="text-fg-muted mt-1 text-sm">{label}</dt>
          </div>
        ))}
      </dl>
      {runtimeNote ? (
        <p className="text-fg-muted mt-3 text-sm">{runtimeNote}</p>
      ) : null}
    </section>
  );
}
