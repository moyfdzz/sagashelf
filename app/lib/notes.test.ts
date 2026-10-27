import { describe, expect, it } from "vitest";

import {
  countCharacters,
  limitState,
  notesPreviewLength,
  panelOffset,
  previewNotes,
} from "./notes";

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

describe("countCharacters", () => {
  it("counts characters as the database does, not the units of the string", () => {
    expect(countCharacters("")).toBe(0);
    expect(countCharacters("abc")).toBe(3);
    expect(countCharacters("😀😀")).toBe(2);
    expect("😀😀".length).toBe(4);
    expect(countCharacters("a\nb")).toBe(3);
  });
});

describe("limitState", () => {
  it("is ok until 90%, near from there, full at the limit and over after it", () => {
    expect(limitState(0, 2000)).toBe("ok");
    expect(limitState(1799, 2000)).toBe("ok");
    expect(limitState(1800, 2000)).toBe("near");
    expect(limitState(1999, 2000)).toBe("near");
    expect(limitState(2000, 2000)).toBe("full");
    expect(limitState(2001, 2000)).toBe("over");
    expect(limitState(450, 500)).toBe("near");
    expect(limitState(449, 500)).toBe("ok");
  });
});

describe("panelOffset", () => {
  const screen = { viewportWidth: 1000, panelWidth: 320 };

  it("does not move a panel that fits to the right of the icon", () => {
    expect(panelOffset({ ...screen, iconLeft: 100 })).toBe(0);
    expect(panelOffset({ ...screen, iconLeft: 664 })).toBe(0);
  });

  it("slides it left just enough when it would pass the right edge", () => {
    // The farthest left edge that fits is 1000 - 16 - 320 = 664.
    expect(panelOffset({ ...screen, iconLeft: 700 })).toBe(-36);
    expect(panelOffset({ ...screen, iconLeft: 980 })).toBe(-316);
  });

  it("slides it right when the icon is so close to the left edge that it would pass it", () => {
    expect(panelOffset({ ...screen, iconLeft: 4 })).toBe(12);
  });

  it("keeps a panel as wide as the screen allows between the margins on a phone", () => {
    const phone = { viewportWidth: 360, panelWidth: 328 };

    expect(panelOffset({ ...phone, iconLeft: 128 })).toBe(-112);
    expect(128 + panelOffset({ ...phone, iconLeft: 128 })).toBe(16);
    expect(panelOffset({ ...phone, iconLeft: 16 })).toBe(0);
  });

  it("always leaves the panel inside the margins", () => {
    for (const iconLeft of [0, 8, 40, 200, 480, 700, 940, 990]) {
      const left = iconLeft + panelOffset({ ...screen, iconLeft });
      expect(left).toBeGreaterThanOrEqual(16);
      expect(left + 320).toBeLessThanOrEqual(1000 - 16);
    }
  });

  it("uses another margin when it is asked to", () => {
    expect(panelOffset({ ...screen, iconLeft: 0, margin: 0 })).toBe(0);
    expect(panelOffset({ ...screen, iconLeft: 900, margin: 0 })).toBe(-220);
  });
});
