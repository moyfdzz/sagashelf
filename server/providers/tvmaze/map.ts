/**
 * TVmaze (CC BY-SA, credited on the credits page and next to the date) through its REST API
 * (SAG-90, ADR-027). A show answers `GET /shows/<id>?embed=nextepisode` with its `status` and, when
 * it has one, the next episode embedded (read 2026-10-30 and 2026-10-31).
 */

/** The next episode of a show, as it is kept. */
export type TvmazeNextEpisode = {
  /** `YYYY-MM-DD`, in the time of the network that shows it. */
  airDate: string;
  /** The exact moment, when TVmaze says it. */
  airStamp: string | null;
  season: number | null;
  number: number | null;
  name: string | null;
};

export type TvmazeShow = {
  /** `Running`, `Ended`, `To Be Determined` or `In Development`, as TVmaze writes it. */
  status: string | null;
  next: TvmazeNextEpisode | null;
};

const dayShape = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const textOrNull = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, max)
    : null;

const countOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, 9999)
    : null;

/** A show as TVmaze sends it, reduced to what is read. Anything that does not look right is left out. */
export function parseShow(raw: unknown): TvmazeShow {
  const show = (raw ?? {}) as {
    status?: unknown;
    _embedded?: { nextepisode?: Record<string, unknown> | null };
  };
  const status = textOrNull(show.status, 40);
  const episode = show._embedded?.nextepisode;
  const airDate = textOrNull(episode?.airdate, 10);
  if (!episode || !airDate || !dayShape.test(airDate)) {
    return { status, next: null };
  }
  const stamp = textOrNull(episode.airstamp, 40);
  const moment = stamp ? new Date(stamp) : null;
  return {
    status,
    next: {
      airDate,
      airStamp:
        moment && !Number.isNaN(moment.getTime()) ? moment.toISOString() : null,
      season: countOrNull(episode.season),
      number: countOrNull(episode.number),
      name: textOrNull(episode.name, 200),
    },
  };
}

const day = 24 * 60 * 60 * 1000;

/**
 * When a show is asked about again (SAG-90): the day after its next episode comes out, but not
 * later than a week and not sooner than six hours (so an episode whose date has passed is not
 * asked about on every run); a show that is running with no date, in a week; and one that is over,
 * or that TVmaze no longer knows (`null`), in three months.
 */
export function nextCheckAt(now: Date, show: TvmazeShow | null): Date {
  if (show?.next) {
    const after = new Date(`${show.next.airDate}T12:00:00Z`).getTime() + day;
    const soonest = now.getTime() + 6 * 60 * 60 * 1000;
    const latest = now.getTime() + 7 * day;
    return new Date(Math.min(Math.max(after, soonest), latest));
  }
  const running =
    show?.status === "Running" ||
    show?.status === "To Be Determined" ||
    show?.status === "In Development";
  return new Date(now.getTime() + (running ? 7 : 90) * day);
}
