import type { LibraryStatus, SaveInput, Visibility } from "./schema";

/** What the library keeps for one title, in the shape the rules work on. */
export type EntryState = {
  status: LibraryStatus;
  progress: number;
  score: number | null;
  /** `YYYY-MM-DD`. */
  startedAt: string | null;
  finishedAt: string | null;
  rewatchCount: number;
  notes: string | null;
  visibility: Visibility;
};

export type RuleError = "progress_too_high" | "dates_order" | "not_completed";

export type RuleResult =
  { ok: true; next: EntryState } | { ok: false; error: RuleError };

type Context = {
  /** Episodes of the title, specials not counted. 0 when there are none (a movie, a book). */
  totalEpisodes: number;
  /** `YYYY-MM-DD`, in UTC. */
  today: string;
};

/**
 * The entry after a person saves the editor. The form sends every field, so this decides what
 * follows from them: reaching the last episode completes the title, a title marked completed has
 * all its episodes seen, and the dates fill in when a title is started or finished and the
 * person left them empty. A date the person typed is never replaced.
 */
export function applySave(
  current: EntryState,
  input: SaveInput,
  { totalEpisodes, today }: Context,
): RuleResult {
  if (totalEpisodes > 0 && input.progress > totalEpisodes) {
    return { ok: false, error: "progress_too_high" };
  }

  let status = input.status;
  let progress = input.progress;

  // Reaching the last episode in this save completes the title. It does not override a status
  // the person picked on purpose (paused, dropped), and it does not fire again on a title that
  // was already at the end.
  const reachedEnd =
    totalEpisodes > 0 &&
    progress === totalEpisodes &&
    current.progress !== totalEpisodes;
  if (reachedEnd && (status === "planned" || status === "in_progress")) {
    status = "completed";
  }
  // A title marked completed has all its episodes seen.
  if (status === "completed" && totalEpisodes > 0) progress = totalEpisodes;
  // Episodes seen means it is not just planned.
  if (status === "planned" && progress > 0) status = "in_progress";

  let startedAt = input.startedAt;
  let finishedAt = input.finishedAt;
  const started = status !== "planned" || progress > 0;
  if (started && !startedAt) startedAt = today;
  if (status === "completed" && !finishedAt) finishedAt = today;

  if (startedAt && finishedAt && finishedAt < startedAt) {
    return { ok: false, error: "dates_order" };
  }

  return {
    ok: true,
    next: {
      status,
      progress,
      score: input.score,
      startedAt,
      finishedAt,
      rewatchCount: current.rewatchCount,
      notes: input.notes,
      visibility: input.visibility,
    },
  };
}

/**
 * Starts a completed title again: back to the first episode, with a new start date. The counter
 * of times it was watched again goes up now, so it counts the times a person started again.
 * The score and the notes stay.
 */
export function applyRewatch(
  current: EntryState,
  { today }: Pick<Context, "today">,
): RuleResult {
  if (current.status !== "completed") {
    return { ok: false, error: "not_completed" };
  }
  return {
    ok: true,
    next: {
      ...current,
      status: "in_progress",
      progress: 0,
      startedAt: today,
      finishedAt: null,
      rewatchCount: current.rewatchCount + 1,
    },
  };
}

export type SeasonCount = { number: number; episodes: number };

/**
 * Where `progress` episodes seen leaves a person, season by season: "season 2, episode 3". Null
 * when nothing was seen yet or the seasons do not add up to that many episodes.
 */
export function locateProgress(
  seasons: readonly SeasonCount[],
  progress: number,
): { season: number; episode: number } | null {
  if (progress <= 0) return null;
  let left = progress;
  for (const season of [...seasons].sort((a, b) => a.number - b.number)) {
    if (left <= season.episodes)
      return { season: season.number, episode: left };
    left -= season.episodes;
  }
  return null;
}
