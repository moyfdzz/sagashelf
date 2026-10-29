import { describe, expect, it } from "vitest";

import {
  shownEntry,
  totalOf,
  type Pending,
  type TitleEntry,
} from "./title-library";

const none: Pending = { adding: false, status: null, stepping: false };

const series = (overrides: Partial<TitleEntry> = {}): TitleEntry => ({
  status: "in_progress",
  progress: 3,
  progressUnit: null,
  progressTotal: null,
  totalEpisodes: 12,
  ...overrides,
});

describe("totalOf", () => {
  it("is the episodes of the catalog, or the total the person typed for a book", () => {
    expect(totalOf(series())).toBe(12);
    expect(
      totalOf(
        series({ totalEpisodes: 0, progressUnit: "pages", progressTotal: 320 }),
      ),
    ).toBe(320);
  });

  it("is 0 when it is not known", () => {
    expect(totalOf(series({ totalEpisodes: 0 }))).toBe(0);
    expect(
      totalOf(series({ progressUnit: "chapters", progressTotal: null })),
    ).toBe(0);
  });
});

describe("shownEntry", () => {
  it("shows the entry as it is when nothing is on its way", () => {
    expect(shownEntry(series(), none)).toEqual({
      status: "in_progress",
      progress: 3,
    });
    expect(shownEntry(series({ status: null, progress: 0 }), none)).toEqual({
      status: null,
      progress: 0,
    });
  });

  it("shows a title that is being added as planned at once", () => {
    expect(
      shownEntry(series({ status: null, progress: 0 }), {
        ...none,
        adding: true,
      }),
    ).toEqual({ status: "planned", progress: 0 });
  });

  it("shows the status of the button that was pressed", () => {
    for (const status of ["paused", "dropped", "in_progress"]) {
      expect(shownEntry(series(), { ...none, status }).status).toBe(status);
    }
  });

  it("gives a title that is completed all its episodes, like the server does", () => {
    expect(shownEntry(series(), { ...none, status: "completed" })).toEqual({
      status: "completed",
      progress: 12,
    });
  });

  it("does not make up an end for a book that has no total", () => {
    const book = series({
      totalEpisodes: 0,
      progressUnit: "pages",
      progressTotal: null,
      progress: 120,
    });

    expect(shownEntry(book, { ...none, status: "completed" })).toEqual({
      status: "completed",
      progress: 120,
    });
  });

  it("keeps a title with progress in progress when planned is asked, like the server does", () => {
    expect(shownEntry(series(), { ...none, status: "planned" })).toEqual({
      status: "in_progress",
      progress: 3,
    });
    expect(
      shownEntry(series({ status: "paused", progress: 0 }), {
        ...none,
        status: "planned",
      }).status,
    ).toBe("planned");
  });

  it("ignores a status that is not one of ours", () => {
    expect(shownEntry(series(), { ...none, status: "evil" }).status).toBe(
      "in_progress",
    );
    expect(shownEntry(series(), { ...none, status: null }).status).toBe(
      "in_progress",
    );
  });

  it("adds one with the step, and starts a planned title", () => {
    expect(shownEntry(series(), { ...none, stepping: true })).toEqual({
      status: "in_progress",
      progress: 4,
    });
    expect(
      shownEntry(series({ status: "planned", progress: 0 }), {
        ...none,
        stepping: true,
      }),
    ).toEqual({ status: "in_progress", progress: 1 });
  });

  it("completes a title with the last step, but not a paused or dropped one", () => {
    expect(
      shownEntry(series({ progress: 11 }), { ...none, stepping: true }),
    ).toEqual({ status: "completed", progress: 12 });
    for (const status of ["paused", "dropped"] as const) {
      expect(
        shownEntry(series({ status, progress: 11 }), {
          ...none,
          stepping: true,
        }).status,
      ).toBe(status);
    }
  });

  it("never completes a book with no total by stepping", () => {
    const book = series({
      totalEpisodes: 0,
      progressUnit: "chapters",
      progressTotal: null,
      progress: 40,
    });

    expect(shownEntry(book, { ...none, stepping: true })).toEqual({
      status: "in_progress",
      progress: 41,
    });
  });

  it("does not step a title that is not in the library", () => {
    expect(
      shownEntry(series({ status: null, progress: 0 }), {
        ...none,
        stepping: true,
      }),
    ).toEqual({ status: null, progress: 0 });
  });
});
