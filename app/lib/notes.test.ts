import { describe, expect, it } from "vitest";

import { notesPreviewLength, previewNotes } from "./notes";

describe("previewNotes", () => {
  it("gives a short note as it is", () => {
    expect(previewNotes("Muy buena")).toEqual({
      text: "Muy buena",
      truncated: false,
    });
  });

  it("gives a note of exactly the limit whole, and one character more cut", () => {
    const exact = "a".repeat(notesPreviewLength);

    expect(previewNotes(exact)).toEqual({ text: exact, truncated: false });
    expect(previewNotes(`${exact}b`)).toEqual({
      text: `${exact}…`,
      truncated: true,
    });
  });

  it("counts characters as the database does, so an emoji is one and is never cut in half", () => {
    const text = "😀".repeat(5);

    expect(previewNotes(text, 5)).toEqual({ text, truncated: false });
    expect(previewNotes(text, 3)).toEqual({ text: "😀😀😀…", truncated: true });
  });

  it("does not leave a space before the ellipsis, and keeps the line breaks", () => {
    expect(previewNotes("uno dos\ntres cuatro", 8)).toEqual({
      text: "uno dos…",
      truncated: true,
    });
    expect(previewNotes("uno\ndos tres", 5)).toEqual({
      text: "uno\nd…",
      truncated: true,
    });
  });

  it("takes an empty note as short", () => {
    expect(previewNotes("")).toEqual({ text: "", truncated: false });
  });
});
