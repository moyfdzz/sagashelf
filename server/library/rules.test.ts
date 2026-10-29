import { describe, expect, it } from "vitest";

import {
  applyRewatch,
  applyStep,
  timesWatched,
  applySave,
  locateProgress,
  type EntryState,
} from "./rules";
import type { SaveInput } from "./schema";

const today = "2026-10-25";

const planned: EntryState = {
  status: "planned",
  progress: 0,
  progressUnit: null,
  progressTotal: null,
  score: null,
  startedAt: null,
  finishedAt: null,
  notes: null,
  visibility: "private",
};

/** What the form sends when nothing was touched, with the changes on top. */
const form = (overrides: Partial<SaveInput> = {}): SaveInput => ({
  intent: "save",
  status: "planned",
  progress: 0,
  progressUnit: null,
  progressTotal: null,
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
  type = "series",
): EntryState {
  const result = applySave(current, input, { totalEpisodes, type, today });
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
      type: "series",
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
      { totalEpisodes: 24, type: "series", today },
    );

    expect(result).toEqual({ ok: false, error: "dates_order" });
  });

  it("refuses a finish date before the start date that was filled in for the person", () => {
    // Started today by default, finished in the past by the person: the dates do not line up.
    const result = applySave(
      planned,
      form({ status: "completed", finishedAt: "2020-01-01" }),
      { totalEpisodes: 24, type: "series", today },
    );

    expect(result).toEqual({ ok: false, error: "dates_order" });
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
    notes: "Para ver otra vez",
  };

  it("starts again from the first episode and keeps the score and the notes", () => {
    const result = applyRewatch(completed, { today });

    expect(result).toEqual({
      ok: true,
      next: {
        ...completed,
        status: "in_progress",
        progress: 0,
        startedAt: today,
        finishedAt: null,
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

describe("timesWatched", () => {
  it("counts the earlier viewings, and the current run only when it is completed", () => {
    expect(timesWatched(0, "completed")).toBe(1);
    expect(timesWatched(2, "completed")).toBe(3);
    expect(timesWatched(2, "in_progress")).toBe(2);
    expect(timesWatched(0, "planned")).toBe(0);
  });
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

describe("applySave for a book or a manga", () => {
  const reading = (overrides: Partial<SaveInput> = {}) =>
    form({
      status: "in_progress",
      progressUnit: "pages",
      progressTotal: 320,
      ...overrides,
    });

  it("completes a book when the last page is reached", () => {
    const next = save(planned, reading({ progress: 320 }), 0, "book");

    expect(next).toMatchObject({
      status: "completed",
      progress: 320,
      progressUnit: "pages",
      progressTotal: 320,
      finishedAt: today,
    });
  });

  it("never completes by itself when the person gave no total", () => {
    const next = save(
      planned,
      reading({ progress: 900, progressTotal: null }),
      0,
      "book",
    );

    expect(next).toMatchObject({
      status: "in_progress",
      progress: 900,
      progressTotal: null,
    });
  });

  it("does not let the progress pass the total", () => {
    const result = applySave(planned, reading({ progress: 321 }), {
      totalEpisodes: 0,
      type: "book",
      today,
    });

    expect(result).toEqual({ ok: false, error: "progress_too_high" });
  });

  it("does not override a status picked on purpose when the end is reached", () => {
    const next = save(
      planned,
      reading({ status: "paused", progress: 320 }),
      0,
      "book",
    );

    expect(next.status).toBe("paused");
  });

  it("gives a book marked completed all its pages", () => {
    const next = save(planned, reading({ status: "completed" }), 0, "book");

    expect(next.progress).toBe(320);
  });

  it("does not complete again a title that was already at the end", () => {
    const atEnd: EntryState = {
      ...planned,
      status: "paused",
      progress: 320,
      progressUnit: "pages",
      progressTotal: 320,
    };

    const next = save(atEnd, reading({ progress: 320 }), 0, "book");

    expect(next.status).toBe("in_progress");
  });

  it("completes a title whose total was typed after the last page was reached", () => {
    const next = save(
      { ...planned, status: "in_progress", progress: 320 },
      reading({ progress: 320 }),
      0,
      "book",
    );

    expect(next.status).toBe("completed");
  });

  it("counts a book in pages whatever the form sends", () => {
    const next = save(
      planned,
      reading({ progressUnit: "volumes", progress: 3 }),
      0,
      "book",
    );

    expect(next.progressUnit).toBe("pages");
  });

  it("lets a manga count chapters or volumes, chapters by default", () => {
    const volumes = save(
      planned,
      reading({ progressUnit: "volumes", progressTotal: 12, progress: 3 }),
      0,
      "manga",
    );
    const fallback = save(
      planned,
      reading({ progressUnit: null, progress: 3 }),
      0,
      "manga",
    );

    expect(volumes).toMatchObject({ progressUnit: "volumes", progress: 3 });
    expect(fallback.progressUnit).toBe("chapters");
  });

  it("keeps no unit and no total on a series, where the catalog has the episodes", () => {
    const next = save(planned, reading({ progress: 5 }), 24, "series");

    expect(next).toMatchObject({
      progressUnit: null,
      progressTotal: null,
      progress: 5,
    });
  });

  it("starts again from zero and keeps the unit and the total", () => {
    const done: EntryState = {
      ...planned,
      status: "completed",
      progress: 320,
      progressUnit: "pages",
      progressTotal: 320,
    };

    const result = applyRewatch(done, { today });

    expect(result).toMatchObject({
      ok: true,
      next: { progress: 0, progressUnit: "pages", progressTotal: 320 },
    });
  });
});

describe("applyStep", () => {
  const context = { totalEpisodes: 24, type: "series", today };
  const step = (current: EntryState, overrides = context) => {
    const result = applyStep(current, overrides);
    if (!result.ok) throw new Error(`unexpected rule error: ${result.error}`);
    return result.next;
  };
  const watching: EntryState = {
    ...planned,
    status: "in_progress",
    progress: 3,
    startedAt: "2026-01-01",
  };

  it("adds one episode and changes nothing else", () => {
    expect(step(watching)).toEqual({ ...watching, progress: 4 });
  });

  it("starts a planned title: in progress, with the start date of today", () => {
    expect(step(planned)).toMatchObject({
      status: "in_progress",
      progress: 1,
      startedAt: today,
    });
  });

  it("completes the title at the last episode, with the finish date of today", () => {
    expect(step({ ...watching, progress: 23 })).toMatchObject({
      status: "completed",
      progress: 24,
      finishedAt: today,
    });
  });

  it("does not complete a paused or dropped title that reaches the end", () => {
    for (const status of ["paused", "dropped"] as const) {
      expect(step({ ...watching, status, progress: 23 }).status).toBe(status);
    }
  });

  it("refuses to go past the end", () => {
    expect(applyStep({ ...watching, progress: 24 }, context)).toEqual({
      ok: false,
      error: "progress_too_high",
    });
  });

  it("counts the pages of a book against the total the person typed", () => {
    const reading: EntryState = {
      ...watching,
      progress: 319,
      progressUnit: "pages",
      progressTotal: 320,
    };

    expect(
      step(reading, { ...context, totalEpisodes: 0, type: "book" }),
    ).toMatchObject({
      status: "completed",
      progress: 320,
      progressUnit: "pages",
    });
  });

  it("never completes a book that has no total", () => {
    const reading: EntryState = {
      ...watching,
      progress: 40,
      progressUnit: "chapters",
    };

    expect(
      step(reading, { ...context, totalEpisodes: 0, type: "manga" }),
    ).toMatchObject({
      status: "in_progress",
      progress: 41,
    });
  });
});
