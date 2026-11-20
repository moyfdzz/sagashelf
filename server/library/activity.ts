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
 * - `rated`: the score is set and differs from the one before.
 *
 * Every event is **one per person, title, kind and day** (UTC): a later one the same day updates it
 * instead of adding another, so ten "+1", a score changed three times or a status switched back and
 * forth show once. Two changes only correct what today already says: taking the score away deletes
 * today's `rated`, and lowering the progress (undoing a "+1") puts the new number in today's
 * `progressed`; neither adds an event. Pausing, planning again, the notes, the dates and the
 * visibility are never events. The notes never go in a payload: they are private to the owner.
 */
export type ActivityKind =
  "started" | "progressed" | "completed" | "dropped" | "rated";

export type ActivityEvent =
  /** Updates today's event of this kind, or adds one when there is none. */
  | { write: "add"; type: ActivityKind; payload: Payload }
  /** Updates today's event of this kind if there is one; never adds. */
  | { write: "correct"; type: ActivityKind; payload: Payload }
  /** Deletes today's event of this kind, if there is one. */
  | { write: "retract"; type: ActivityKind };

/** Small public details: the progress and its unit, the score, a rewatch. */
type Payload = Record<string, string | number | boolean>;

/** What `progress` counts: the unit of a book or a manga, or episodes. */
const unitOf = (entry: EntryState) => entry.progressUnit ?? "episodes";

const progressOf = (entry: EntryState): Payload => ({
  progress: entry.progress,
  unit: unitOf(entry),
});

export function activityOf(
  before: EntryState,
  after: EntryState,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const statusChanged = before.status !== after.status;

  if (statusChanged && after.status === "completed") {
    events.push({ write: "add", type: "completed", payload: {} });
  } else if (statusChanged && after.status === "dropped") {
    events.push({ write: "add", type: "dropped", payload: {} });
  } else if (
    before.status === "planned" &&
    (after.status === "in_progress" || after.status === "paused")
  ) {
    events.push({ write: "add", type: "started", payload: {} });
  } else if (after.progress > before.progress) {
    events.push({
      write: "add",
      type: "progressed",
      payload: progressOf(after),
    });
  } else if (after.progress < before.progress) {
    events.push({
      write: "correct",
      type: "progressed",
      payload: progressOf(after),
    });
  }

  if (after.score !== null && after.score !== before.score) {
    events.push({
      write: "add",
      type: "rated",
      payload: { score: after.score },
    });
  } else if (after.score === null && before.score !== null) {
    events.push({ write: "retract", type: "rated" });
  }
  return events;
}

/** The event of a rewatch: the title starts again. */
export const rewatchActivity: ActivityEvent = {
  write: "add",
  type: "started",
  payload: { rewatch: true },
};
