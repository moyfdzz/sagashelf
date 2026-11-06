import { describe, expect, it } from "vitest";

import { pictureType } from "./picture-file";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("pictureType", () => {
  it("knows the three accepted types by their first bytes", () => {
    expect(pictureType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(
      pictureType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe("image/png");
    expect(pictureType(text("RIFF\u0001\u0002\u0003\u0004WEBPVP8 "))).toBe(
      "image/webp",
    );
  });

  it("refuses an SVG, which can carry a script", () => {
    expect(
      pictureType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(pictureType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
  });

  it("refuses a program, a page and a GIF, whatever the file says it is", () => {
    expect(pictureType(text("MZ\u0090\u0000"))).toBeNull();
    expect(pictureType(text("<!doctype html><script>"))).toBeNull();
    expect(pictureType(text("GIF89a"))).toBeNull();
  });

  it("refuses another RIFF file, which is not a WebP", () => {
    expect(
      pictureType(text("RIFF\u0001\u0002\u0003\u0004WAVEfmt ")),
    ).toBeNull();
  });

  it("refuses an empty file and one cut before its signature ends", () => {
    expect(pictureType(new Uint8Array())).toBeNull();
    expect(pictureType(bytes(0xff, 0xd8))).toBeNull();
    expect(pictureType(bytes(0x89, 0x50, 0x4e))).toBeNull();
  });
});
