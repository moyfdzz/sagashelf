import { describe, expect, it } from "vitest";

import { importFinishedNotice, importFinishedType } from "./import-notice";

describe("the notice of a finished import", () => {
  it("has the type the database allows", () => {
    expect(importFinishedType).toBe("import.finished");
  });

  it("reads the counts and nothing else of its payload", () => {
    expect(
      importFinishedNotice({
        jobId: "abc",
        imported: 12,
        problems: 3,
        title: "Secret title",
      }),
    ).toEqual({ imported: 12, problems: 3 });
    expect(importFinishedNotice({ imported: 0, problems: 0 })).toEqual({
      imported: 0,
      problems: 0,
    });
  });

  it("is not readable when a count is missing, negative, fractional or not a number", () => {
    for (const payload of [
      {},
      { imported: 1 },
      { problems: 1 },
      { imported: -1, problems: 0 },
      { imported: 1.5, problems: 0 },
      { imported: "1", problems: 0 },
      { imported: null, problems: 0 },
    ]) {
      expect(importFinishedNotice(payload)).toBeNull();
    }
  });
});
