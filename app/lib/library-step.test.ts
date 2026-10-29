import { describe, expect, it } from "vitest";

import { canStep, type StepRow } from "./library-step";

const series: StepRow = {
  status: "in_progress",
  progress: 3,
  totalEpisodes: 12,
  progressUnit: null,
  progressTotal: null,
};

describe("canStep", () => {
  it("is for a title with episodes that has not reached the end", () => {
    expect(canStep(series)).toBe(true);
    expect(canStep({ ...series, progress: 11 })).toBe(true);
  });

  it("is not for a title at its end, or completed", () => {
    expect(canStep({ ...series, progress: 12 })).toBe(false);
    expect(canStep({ ...series, status: "completed" })).toBe(false);
  });

  it("is not for a title with nothing to count, like a movie", () => {
    expect(canStep({ ...series, totalEpisodes: 0, progress: 0 })).toBe(false);
  });

  it("is for a book or a manga, with a total until it is reached", () => {
    const book: StepRow = {
      ...series,
      totalEpisodes: 0,
      progressUnit: "pages",
      progressTotal: 320,
      progress: 319,
    };

    expect(canStep(book)).toBe(true);
    expect(canStep({ ...book, progress: 320 })).toBe(false);
  });

  it("is for a book with no total at any point, even before the first page", () => {
    const book: StepRow = {
      ...series,
      status: "planned",
      progress: 0,
      totalEpisodes: 0,
      progressUnit: "chapters",
      progressTotal: null,
    };

    expect(canStep(book)).toBe(true);
    expect(canStep({ ...book, progress: 900 })).toBe(true);
  });
});
