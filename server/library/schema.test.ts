import { describe, expect, it } from "vitest";

import {
  addEntrySchema,
  libraryActionSchema,
  libraryQuerySchema,
  notesMaxLength,
  searchMaxLength,
} from "./schema";

const valid = {
  intent: "save",
  status: "in_progress",
  progress: "3",
  score: "8",
  startedAt: "2026-01-02",
  finishedAt: "",
  notes: "  una nota  ",
  visibility: "private",
};

describe("libraryActionSchema", () => {
  it("reads the form of the editor", () => {
    expect(libraryActionSchema.parse(valid)).toEqual({
      intent: "save",
      status: "in_progress",
      progress: 3,
      score: 8,
      startedAt: "2026-01-02",
      finishedAt: null,
      notes: "una nota",
      visibility: "private",
    });
  });

  it("reads empty fields as no value", () => {
    const parsed = libraryActionSchema.parse({
      ...valid,
      score: "",
      startedAt: "",
      notes: "   ",
    });

    expect(parsed).toMatchObject({
      score: null,
      startedAt: null,
      notes: null,
    });
  });

  it("reads a form that leaves out the finish date, which the page does while the title is not completed", () => {
    const withoutFinish = { ...valid, finishedAt: undefined };

    expect(libraryActionSchema.parse(withoutFinish)).toMatchObject({
      finishedAt: null,
    });
  });

  it("reads the two short forms", () => {
    expect(libraryActionSchema.parse({ intent: "remove" })).toEqual({
      intent: "remove",
    });
    expect(libraryActionSchema.parse({ intent: "rewatch" })).toEqual({
      intent: "rewatch",
    });
  });

  it.each([
    ["an unknown status", { status: "watching" }],
    ["a negative progress", { progress: "-1" }],
    ["a progress with decimals", { progress: "1.5" }],
    ["a progress that is not a number", { progress: "abc" }],
    ["a progress with too many digits", { progress: "1000000" }],
    ["a progress above the limit", { progress: "100001" }],
    ["a score of 0", { score: "0" }],
    ["a score of 11", { score: "11" }],
    ["a score with half points", { score: "7.5" }],
    ["a date that does not exist", { startedAt: "2026-02-30" }],
    ["a date in another format", { startedAt: "02/01/2026" }],
    ["an unknown visibility", { visibility: "everyone" }],
  ])("refuses %s", (_name, change) => {
    expect(libraryActionSchema.safeParse({ ...valid, ...change }).success).toBe(
      false,
    );
  });

  it("refuses notes over the limit, counting characters and not code units", () => {
    expect(
      libraryActionSchema.safeParse({
        ...valid,
        notes: "😀".repeat(notesMaxLength),
      }).success,
    ).toBe(true);
    const tooLong = libraryActionSchema.safeParse({
      ...valid,
      notes: "a".repeat(notesMaxLength + 1),
    });

    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe("notes_too_long");
  });

  it("refuses a field the form does not have, and an unknown intent", () => {
    expect(
      libraryActionSchema.safeParse({ ...valid, userId: "someone-else" })
        .success,
    ).toBe(false);
    expect(
      libraryActionSchema.safeParse({ intent: "remove", status: "planned" })
        .success,
    ).toBe(false);
    expect(
      libraryActionSchema.safeParse({ intent: "drop-table" }).success,
    ).toBe(false);
    expect(libraryActionSchema.safeParse({}).success).toBe(false);
  });
});

describe("addEntrySchema", () => {
  it("takes one title id", () => {
    const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

    expect(addEntrySchema.parse({ mediaId })).toEqual({ mediaId });
    expect(addEntrySchema.safeParse({ mediaId: "nope" }).success).toBe(false);
    expect(addEntrySchema.safeParse({ mediaId, userId: "x" }).success).toBe(
      false,
    );
  });
});

const firstPages = {
  in_progress: 1,
  planned: 1,
  paused: 1,
  dropped: 1,
  completed: 1,
};

describe("libraryQuerySchema", () => {
  it("has defaults for an address with no filters", () => {
    expect(libraryQuerySchema.parse({})).toEqual({
      sort: "recent",
      pages: firstPages,
    });
  });

  it("reads the tab, the search, the filters, the sort, the view and the page of each section", () => {
    expect(
      libraryQuerySchema.parse({
        type: "anime",
        q: "  dune ",
        year: "2013",
        score: "8",
        sort: "score",
        view: "grid",
        completed_page: "3",
        planned_page: "2",
      }),
    ).toEqual({
      type: "anime",
      q: "dune",
      year: 2013,
      score: 8,
      sort: "score",
      view: "grid",
      pages: { ...firstPages, completed: 3, planned: 2 },
    });
  });

  it("ignores a value that is not valid instead of failing", () => {
    expect(
      libraryQuerySchema.parse({
        type: "custom",
        q: "   ",
        year: "20x3",
        score: "11",
        sort: "random",
        view: "table",
        completed_page: "0",
        paused_page: "abc",
        status: "completed",
        page: "4",
      }),
    ).toEqual({ sort: "recent", pages: firstPages });
  });

  it("reads the visibility, and ignores one that is not a level", () => {
    for (const visibility of ["public", "friends", "private"]) {
      expect(libraryQuerySchema.parse({ visibility }).visibility).toBe(
        visibility,
      );
    }
    for (const visibility of ["everyone", "PUBLIC", "", "1"]) {
      expect(
        libraryQuerySchema.parse({ visibility }).visibility,
      ).toBeUndefined();
    }
  });

  it("cuts a search that is too long", () => {
    expect(libraryQuerySchema.parse({ q: "a".repeat(500) }).q).toHaveLength(
      searchMaxLength,
    );
  });
});
