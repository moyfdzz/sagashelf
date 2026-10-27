import { describe, expect, it } from "vitest";

import {
  addEntrySchema,
  libraryActionSchema,
  libraryQuerySchema,
  notesMaxLength,
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

describe("libraryQuerySchema", () => {
  it("has defaults for an address with no filters", () => {
    expect(libraryQuerySchema.parse({})).toEqual({
      sort: "recent",
      page: 1,
    });
  });

  it("reads the filters, the sort and the page", () => {
    expect(
      libraryQuerySchema.parse({
        type: "anime",
        status: "completed",
        year: "2013",
        score: "8",
        sort: "score",
        page: "3",
      }),
    ).toEqual({
      type: "anime",
      status: "completed",
      year: 2013,
      score: 8,
      sort: "score",
      page: 3,
    });
  });

  it("ignores a value that is not valid instead of failing", () => {
    expect(
      libraryQuerySchema.parse({
        type: "custom",
        status: "<script>",
        year: "20x3",
        score: "11",
        sort: "random",
        page: "0",
      }),
    ).toEqual({ sort: "recent", page: 1 });
  });
});
