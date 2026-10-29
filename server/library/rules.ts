import { progressUnitsFor } from "./schema";
import type {
  LibraryStatus,
  ProgressUnit,
  SaveInput,
  Visibility,
} from "./schema";

/** What the library keeps for one title, in the shape the rules work on. */
export type EntryState = {
  status: LibraryStatus;
  progress: number;
  /** What `progress` counts for a book or a manga. Null when it counts episodes. */
  progressUnit: ProgressUnit | null;
  /** How many units the person's edition has, when they said. Null for episodes. */
  progressTotal: number | null;
  score: number | null;
  /** `YYYY-MM-DD`. */
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
  visibility: Visibility;
};

export type RuleError = "progress_too_high" | "dates_order" | "not_completed";

export type RuleResult =
  { ok: true; next: EntryState } | { ok: false; error: RuleError };

type Context = {
  /** Episodes of the title, specials not counted. 0 when there are none (a movie, a book). */
  totalEpisodes: number;
  /** The kind of title, which decides the units its progress can count. */
  type: string;
  /** `YYYY-MM-DD`, in UTC. */
  today: string;
};

/**
 * The entry after a person saves the editor. The form sends every field, so this decides what
 * follows from them: reaching the last episode completes the title, a title marked completed has
 * all its episodes seen, and the dates fill in when a title is started or finished and the
 * person left them empty. A date the person typed is never replaced. A book or a manga counts
 * pages, chapters or volumes against the total the person typed; without one it never completes
 * by itself.
 */
export function applySave(
  current: EntryState,
  input: SaveInput,
  { totalEpisodes, type, today }: Context,
): RuleResult {
  // A unit the kind of title cannot count is dropped, and a book always counts pages.
  const allowed = progressUnitsFor(type);
  const progressUnit =
    allowed.find((unit) => unit === input.progressUnit) ?? allowed[0] ?? null;
  const progressTotal = progressUnit ? input.progressTotal : null;
  // The end of the title: the catalog's episodes, or the total the person typed.
  const total = progressUnit ? (progressTotal ?? 0) : totalEpisodes;

  if (total > 0 && input.progress > total) {
    return { ok: false, error: "progress_too_high" };
  }

  let status = input.status;
  let progress = input.progress;

  // Reaching the last unit in this save completes the title. It does not override a status
  // the person picked on purpose (paused, dropped), and it does not fire again on a title that
  // was already at the end.
  const wasAtEnd =
    current.progress === total && current.progressTotal === progressTotal;
  const reachedEnd = total > 0 && progress === total && !wasAtEnd;
  if (reachedEnd && (status === "planned" || status === "in_progress")) {
    status = "completed";
  }
  // A title marked completed has all its units done.
  if (status === "completed" && total > 0) progress = total;
  // Progress made means it is not just planned.
  if (status === "planned" && progress > 0) status = "in_progress";

  let startedAt = input.startedAt;
  // A title that is not completed has not been finished, whatever the form says.
  let finishedAt = status === "completed" ? input.finishedAt : null;
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
      progressUnit,
      progressTotal,
      score: input.score,
      startedAt,
      finishedAt,
      notes: input.notes,
      visibility: input.visibility,
    },
  };
}

/**
 * One more episode, page, chapter or volume, as the quick button of the library does it. It is a
 * save of the whole entry with the progress one higher, so every rule of `applySave` holds: the
 * end completes the title, going past it is refused, and a planned title becomes in progress
 * with a start date.
 */
export function applyStep(current: EntryState, context: Context): RuleResult {
  return applySave(
    current,
    {
      intent: "save",
      status: current.status,
      progress: current.progress + 1,
      progressUnit: current.progressUnit,
      progressTotal: current.progressTotal,
      score: current.score,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      notes: current.notes,
      visibility: current.visibility,
    },
    context,
  );
}

/**
 * Another status for the entry, as the quick buttons of the title page do it. It is a save of the
 * whole entry with only the status changed, so every rule of `applySave` holds: a completed
 * title has all its episodes seen, a finish date only belongs to a completed title, and a planned
 * title with progress is in progress, so asking for "planned" then gives "in progress".
 */
export function applyStatus(
  current: EntryState,
  status: LibraryStatus,
  context: Context,
): RuleResult {
  return applySave(
    current,
    {
      intent: "save",
      status,
      progress: current.progress,
      progressUnit: current.progressUnit,
      progressTotal: current.progressTotal,
      score: current.score,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      notes: current.notes,
      visibility: current.visibility,
    },
    context,
  );
}

/**
 * Starts a completed title again: back to the first episode, with a new start date. The run that
 * ends is saved with its dates in the history of viewings by the caller (`rewatchEntry`), so
 * nothing is counted here. The score and the notes stay.
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
    },
  };
}

/** The times a person has watched a title: the earlier viewings, and the current run if finished. */
export const timesWatched = (
  earlierViewings: number,
  status: LibraryStatus,
): number => earlierViewings + (status === "completed" ? 1 : 0);

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
