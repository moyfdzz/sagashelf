import type { EntryState } from "./rules";

/**
 * What a change of a library entry tells the people who follow the person (SAG-44, ADR-054). It is
 * a pure function of the entry before and after the change, so every case is a unit test; the
 * writer (`saveEntry`, `rewatchEntry`) puts the events in the same statement as the change, so an
 * event exists if and only if the change was written.
 *
 * - `started`: a planned title is now in progress or paused. A rewatch is `started` with
 *   `rewatch: true`.
 * - `progressed`: the progress went up and nothing bigger happened in the same change.
 * - `completed`, `dropped`: the status became that one.
 * - `rated`: the score is set and differs from the one before. Taking a score away says nothing.
 *
 * `progressed` and `rated` are **daily**: one per person, title and day (UTC), and a later one the
 * same day updates it instead of adding another, so ten "+1" or a score changed three times show
 * once. Pausing, planning again, the notes, the dates and the visibility are never events. The
 * notes never go in a payload: they are private to the owner.
 */
export type ActivityKind =
  "started" | "progressed" | "completed" | "dropped" | "rated";

export type ActivityEvent = {
  type: ActivityKind;
  /** Small public details: the progress and its unit, the score, a rewatch. */
  payload: Record<string, string | number | boolean>;
  /** One per person, title and day: a later one the same day updates it. */
  daily: boolean;
};

/** What `progress` counts: the unit of a book or a manga, or episodes. */
const unitOf = (entry: EntryState) => entry.progressUnit ?? "episodes";

export function activityOf(
  before: EntryState,
  after: EntryState,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const statusChanged = before.status !== after.status;

  if (statusChanged && after.status === "completed") {
    events.push({ type: "completed", payload: {}, daily: false });
  } else if (statusChanged && after.status === "dropped") {
    events.push({ type: "dropped", payload: {}, daily: false });
  } else if (
    before.status === "planned" &&
    (after.status === "in_progress" || after.status === "paused")
  ) {
    events.push({ type: "started", payload: {}, daily: false });
  } else if (after.progress > before.progress) {
    events.push({
      type: "progressed",
      payload: { progress: after.progress, unit: unitOf(after) },
      daily: true,
    });
  }

  if (after.score !== null && after.score !== before.score) {
    events.push({
      type: "rated",
      payload: { score: after.score },
      daily: true,
    });
  }
  return events;
}

/** The event of a rewatch: the title starts again. */
export const rewatchActivity: ActivityEvent = {
  type: "started",
  payload: { rewatch: true },
  daily: false,
};
