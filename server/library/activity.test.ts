import { describe, expect, it } from "vitest";

import { activityOf, rewatchActivity } from "./activity";
import type { EntryState } from "./rules";

const planned: EntryState = {
  status: "planned",
  progress: 0,
  progressUnit: null,
  progressTotal: null,
  score: null,
  startedAt: null,
  finishedAt: null,
  notes: null,
  visibility: "public",
};
const watching: EntryState = {
  ...planned,
  status: "in_progress",
  progress: 3,
  startedAt: "2026-11-01",
};

const types = (before: EntryState, after: EntryState) =>
  activityOf(before, after).map((event) => event.type);

describe("the activity of a library change (SAG-44)", () => {
  it("starts a planned title that is now in progress or paused, and nothing else", () => {
    expect(activityOf(planned, { ...planned, status: "in_progress" })).toEqual([
      { write: "add", type: "started", payload: {} },
    ]);
    expect(types(planned, { ...watching, status: "paused" })).toEqual([
      "started",
    ]);
    // Starting with some progress is still one event: the start.
    expect(types(planned, { ...watching, progress: 4 })).toEqual(["started"]);
  });

  it("says progressed with the progress and its unit", () => {
    expect(activityOf(watching, { ...watching, progress: 4 })).toEqual([
      {
        write: "add",
        type: "progressed",
        payload: { progress: 4, unit: "episodes" },
      },
    ]);
    const book = { ...watching, progressUnit: "pages" as const };
    expect(activityOf(book, { ...book, progress: 120 })).toEqual([
      {
        write: "add",
        type: "progressed",
        payload: { progress: 120, unit: "pages" },
      },
    ]);
  });

  it("only corrects today's progress when the progress goes down (an undone step)", () => {
    expect(activityOf(watching, { ...watching, progress: 2 })).toEqual([
      {
        write: "correct",
        type: "progressed",
        payload: { progress: 2, unit: "episodes" },
      },
    ]);
  });

  it("says completed or dropped instead of progressed when the status changes too", () => {
    expect(
      types(watching, { ...watching, status: "completed", progress: 12 }),
    ).toEqual(["completed"]);
    expect(
      types(watching, { ...watching, status: "dropped", progress: 5 }),
    ).toEqual(["dropped"]);
    // From planned straight to the end: completed, not started.
    expect(types(planned, { ...watching, status: "completed" })).toEqual([
      "completed",
    ]);
    expect(types(planned, { ...planned, status: "dropped" })).toEqual([
      "dropped",
    ]);
  });

  it("does not repeat completed or dropped for an entry that already was", () => {
    const done = { ...watching, status: "completed" as const, progress: 12 };
    expect(types(done, { ...done, notes: "otra vez" })).toEqual([]);
    const gone = { ...watching, status: "dropped" as const };
    expect(types(gone, { ...gone, progress: 4 })).toEqual(["progressed"]);
  });

  it("says rated when the score is set or changes, and retracts today's when it is taken away", () => {
    expect(activityOf(watching, { ...watching, score: 8 })).toEqual([
      { write: "add", type: "rated", payload: { score: 8 } },
    ]);
    const rated = { ...watching, score: 8 };
    expect(types(rated, { ...rated, score: 7 })).toEqual(["rated"]);
    expect(types(rated, { ...rated, score: 8 })).toEqual([]);
    expect(activityOf(rated, { ...rated, score: null })).toEqual([
      { write: "retract", type: "rated" },
    ]);
    expect(activityOf(watching, { ...watching, score: null })).toEqual([]);
  });

  it("writes two events when one change completes and rates", () => {
    expect(
      types(watching, {
        ...watching,
        status: "completed",
        progress: 12,
        score: 9,
      }),
    ).toEqual(["completed", "rated"]);
  });

  it("says nothing for a pause, planning again, notes, dates or visibility", () => {
    expect(types(watching, { ...watching, status: "paused" })).toEqual([]);
    expect(types(watching, { ...watching, status: "planned" })).toEqual([]);
    expect(
      types(watching, {
        ...watching,
        notes: "una nota privada",
        startedAt: "2026-10-01",
        visibility: "private",
      }),
    ).toEqual([]);
    // Coming back to a paused or dropped title is not a start.
    const paused = { ...watching, status: "paused" as const };
    expect(types(paused, { ...paused, status: "in_progress" })).toEqual([]);
  });

  it("never puts the notes in a payload", () => {
    const events = activityOf(planned, {
      ...watching,
      status: "completed",
      score: 10,
      notes: "secreto",
    });
    expect(JSON.stringify(events)).not.toContain("secreto");
  });

  it("marks the start of a rewatch", () => {
    expect(rewatchActivity).toEqual({
      write: "add",
      type: "started",
      payload: { rewatch: true },
    });
  });
});
