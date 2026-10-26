import { describe, expect, it } from "vitest";

import {
  applyRewatch,
  applySave,
  locateProgress,
  type EntryState,
} from "./rules";
import type { SaveInput } from "./schema";

const today = "2026-10-25";

const planned: EntryState = {
  status: "planned",
  progress: 0,
  score: null,
  startedAt: null,
  finishedAt: null,
  rewatchCount: 0,
  notes: null,
  visibility: "private",
};

/** What the form sends when nothing was touched, with the changes on top. */
const form = (overrides: Partial<SaveInput> = {}): SaveInput => ({
  intent: "save",
  status: "planned",
  progress: 0,
  score: null,
  startedAt: null,
  finishedAt: null,
  notes: null,
  visibility: "private",
  ...overrides,
});

function save(
  current: EntryState,
  input: SaveInput,
  totalEpisodes = 24,
): EntryState {
  const result = applySave(current, input, { totalEpisodes, today });
  if (!result.ok) throw new Error(`unexpected rule error: ${result.error}`);
  return result.next;
}

describe("applySave", () => {
  it("keeps a title the person only planned, without dates", () => {
    expect(save(planned, form())).toEqual(planned);
  });

  it("starts a title: the start date is today when the person left it empty", () => {
    const next = save(planned, form({ status: "in_progress", progress: 3 }));

    expect(next).toMatchObject({
      status: "in_progress",
      progress: 3,
      startedAt: today,
      finishedAt: null,
    });
  });

  it("has no finish date for a title that is not completed, whatever the form sends", () => {
    for (const status of [
      "planned",
      "in_progress",
      "paused",
      "dropped",
    ] as const) {
      const next = save(
        planned,
        form({ status, progress: 1, finishedAt: "2026-05-01" }),
      );

      expect(next.finishedAt).toBeNull();
    }
  });

  it("takes the finish date of a completed title from the form", () => {
    const next = save(
      planned,
      form({
        status: "completed",
        startedAt: "2026-05-01",
        finishedAt: "2026-05-09",
      }),
    );

    expect(next.finishedAt).toBe("2026-05-09");
  });

  it("never replaces a date the person typed", () => {
    const next = save(
      planned,
      form({ status: "in_progress", progress: 1, startedAt: "2026-01-02" }),
    );

    expect(next.startedAt).toBe("2026-01-02");
  });

  it("moves a planned title to in progress when episodes were seen", () => {
    expect(save(planned, form({ progress: 2 })).status).toBe("in_progress");
  });

  it("completes the title when the last episode is reached, and sets the finish date", () => {
    const current = {
      ...planned,
      status: "in_progress" as const,
      progress: 20,
    };

    const next = save(current, form({ status: "in_progress", progress: 24 }));

    expect(next).toMatchObject({
      status: "completed",
      progress: 24,
      finishedAt: today,
    });
  });

  it("does not override a status picked on purpose when the last episode is reached", () => {
    const current = {
      ...planned,
      status: "in_progress" as const,
      progress: 20,
    };

    expect(
      save(current, form({ status: "dropped", progress: 24 })).status,
    ).toBe("dropped");
    expect(save(current, form({ status: "paused", progress: 24 })).status).toBe(
      "paused",
    );
  });

  it("does not complete again a title that was already at the end", () => {
    const current = {
      ...planned,
      status: "in_progress" as const,
      progress: 24,
    };

    expect(
      save(current, form({ status: "in_progress", progress: 24 })).status,
    ).toBe("in_progress");
  });

  it("gives all the episodes to a title marked completed", () => {
    const next = save(planned, form({ status: "completed", progress: 5 }));

    expect(next).toMatchObject({
      status: "completed",
      progress: 24,
      startedAt: today,
      finishedAt: today,
    });
  });

  it("completes a title with no episodes (a movie) without touching its progress", () => {
    const next = save(planned, form({ status: "completed" }), 0);

    expect(next).toMatchObject({
      status: "completed",
      progress: 0,
      finishedAt: today,
    });
  });

  it("does not let the progress pass the last episode", () => {
    const result = applySave(planned, form({ progress: 25 }), {
      totalEpisodes: 24,
      today,
    });

    expect(result).toEqual({ ok: false, error: "progress_too_high" });
  });

  it("does not limit the progress of a title whose episodes are not known", () => {
    expect(save(planned, form({ progress: 500 }), 0).progress).toBe(500);
  });

  it("refuses a finish date before the start date", () => {
    const result = applySave(
      planned,
      form({
        status: "completed",
        startedAt: "2026-05-02",
        finishedAt: "2026-05-01",
      }),
      { totalEpisodes: 24, today },
    );

    expect(result).toEqual({ ok: false, error: "dates_order" });
  });

  it("refuses a finish date before the start date that was filled in for the person", () => {
    // Started today by default, finished in the past by the person: the dates do not line up.
    const result = applySave(
      planned,
      form({ status: "completed", finishedAt: "2020-01-01" }),
      { totalEpisodes: 24, today },
    );

    expect(result).toEqual({ ok: false, error: "dates_order" });
  });

  it("keeps the counter of times watched again, which only a new start changes", () => {
    const current = { ...planned, rewatchCount: 3 };

    expect(save(current, form({ score: 8 })).rewatchCount).toBe(3);
  });

  it("takes the score, the notes and the visibility from the form", () => {
    const next = save(
      planned,
      form({ score: 9, notes: "Muy buena", visibility: "public" }),
    );

    expect(next).toMatchObject({
      score: 9,
      notes: "Muy buena",
      visibility: "public",
    });
  });
});

describe("applyRewatch", () => {
  const completed: EntryState = {
    ...planned,
    status: "completed",
    progress: 24,
    score: 9,
    startedAt: "2026-01-01",
    finishedAt: "2026-02-01",
    rewatchCount: 1,
    notes: "Para ver otra vez",
  };

  it("starts again from the first episode, counts it, and keeps the score and the notes", () => {
    const result = applyRewatch(completed, { today });

    expect(result).toEqual({
      ok: true,
      next: {
        ...completed,
        status: "in_progress",
        progress: 0,
        startedAt: today,
        finishedAt: null,
        rewatchCount: 2,
      },
    });
  });

  it.each(["planned", "in_progress", "paused", "dropped"] as const)(
    "refuses a title that is %s",
    (status) => {
      expect(applyRewatch({ ...completed, status }, { today })).toEqual({
        ok: false,
        error: "not_completed",
      });
    },
  );
});

describe("locateProgress", () => {
  const seasons = [
    { number: 2, episodes: 12 },
    { number: 1, episodes: 25 },
  ];

  it("says nothing before the first episode", () => {
    expect(locateProgress(seasons, 0)).toBeNull();
  });

  it("finds the season and the episode, whatever the order of the seasons", () => {
    expect(locateProgress(seasons, 1)).toEqual({ season: 1, episode: 1 });
    expect(locateProgress(seasons, 25)).toEqual({ season: 1, episode: 25 });
    expect(locateProgress(seasons, 26)).toEqual({ season: 2, episode: 1 });
    expect(locateProgress(seasons, 37)).toEqual({ season: 2, episode: 12 });
  });

  it("says nothing when the seasons hold fewer episodes than that", () => {
    expect(locateProgress(seasons, 38)).toBeNull();
    expect(locateProgress([], 3)).toBeNull();
  });
});
