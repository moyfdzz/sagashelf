import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  externalLinkClass,
  forwardLinkClass,
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryLinkClass,
  segmentClass,
  tabClass,
} from "./ui";

describe("the look of what is pressed", () => {
  it("fills the chosen tab and the chosen segment, and gives the others a border or plain text", () => {
    expect(tabClass(true)).toContain("bg-accent text-accent-fg");
    expect(tabClass(false)).not.toContain("bg-accent");
    expect(tabClass(false)).toContain("border-border");
    expect(segmentClass(true)).toContain("bg-accent text-accent-fg");
    expect(segmentClass(false)).not.toContain("bg-accent");
  });

  it("keeps a link that acts as a button on one line, in a box that sits in the line", () => {
    expect(secondaryLinkClass).toContain("whitespace-nowrap");
    expect(secondaryLinkClass).toContain("inline-block");
    expect(secondaryLinkClass).toContain(secondaryButtonClass);
  });

  it("makes a button and a link-button look the same, and never like a hyperlink", () => {
    for (const className of [
      primaryButtonClass,
      secondaryButtonClass,
      secondaryLinkClass,
      tabClass(false),
      segmentClass(false),
    ]) {
      expect(className).not.toContain("underline");
      expect(className).toContain("focus-visible:outline-2");
    }
  });
});

describe("the look of a link", () => {
  it("is blue and underlined before the pointer arrives, with the underline a little apart", () => {
    expect(linkClass).toContain("text-accent");
    expect(linkClass).toMatch(/(^| )underline( |$)/);
    expect(linkClass).toContain("underline-offset-4");
  });

  it("gets a thicker amber underline under the pointer and under the keyboard focus", () => {
    for (const state of ["hover", "focus-visible"]) {
      expect(linkClass).toContain(`${state}:decoration-2`);
      expect(linkClass).toContain(`${state}:decoration-link-hover`);
    }
    // The focus ring of the other controls stays.
    expect(linkClass).toContain("focus-visible:outline-2");
  });

  it("moves softly, and not at all for a person who asked for less motion", () => {
    expect(linkClass).toContain("duration-150");
    expect(linkClass).toContain(
      "transition-[text-decoration-color,text-decoration-thickness]",
    );
    expect(linkClass).toContain("motion-reduce:transition-none");
  });

  it("keeps the text color on hover: the amber is never a color for text on the light page", () => {
    expect(linkClass).not.toContain("hover:text-");
  });

  it("adds an arrow that a screen reader does not read, to the links that go somewhere", () => {
    expect(forwardLinkClass).toContain(linkClass);
    expect(forwardLinkClass).toContain("after:content-['→'_/_'']");
    expect(externalLinkClass).toContain(linkClass);
    expect(externalLinkClass).toContain("after:content-['↗'_/_'']");
    // An inline block, so the underline does not run under the arrow.
    expect(forwardLinkClass).toContain("after:inline-block");
    expect(externalLinkClass).toContain("after:inline-block");
  });

  it("is not the look of a button", () => {
    expect(linkClass).not.toContain("bg-accent");
    expect(linkClass).not.toContain("border");
  });
});

describe("the links of the site", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /.tsx?$/.test(entry.name) && !/.test.tsx?$/.test(entry.name)
        ? [path]
        : [];
    });

  it("all use the shared look, and none writes its own", () => {
    const own = sources(join(__dirname, ".."))
      .filter((path) => !path.endsWith(join("lib", "ui.ts")))
      .filter((path) =>
        /text-accent underline|hover:text-accent underline/.test(
          readFileSync(path, "utf8"),
        ),
      );

    expect(own).toEqual([]);
  });
});
