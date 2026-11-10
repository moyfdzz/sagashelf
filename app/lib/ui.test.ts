import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  dangerButtonClass,
  externalLinkClass,
  forwardLinkClass,
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryLinkClass,
  segmentClass,
  tabClass,
  textLinkClass,
  wrappingSecondaryLinkClass,
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

  it("has a link-button for a long label that has the same look but is not kept on one line", () => {
    // That it no longer scrolls the page sideways is tried in a browser (e2e/account.spec.ts).
    expect(wrappingSecondaryLinkClass).toContain(secondaryButtonClass);
    expect(wrappingSecondaryLinkClass).not.toContain("whitespace-nowrap");
  });

  it("makes a button and a link-button look the same, and never like a hyperlink", () => {
    for (const className of [
      primaryButtonClass,
      secondaryButtonClass,
      dangerButtonClass,
      secondaryLinkClass,
      tabClass(false),
      segmentClass(false),
    ]) {
      expect(className).not.toContain("underline");
      expect(className).toContain("focus-visible:outline-2");
    }
  });
});

describe("the button that deletes (SAG-98)", () => {
  const tokens = (className: string) => className.split(/\s+/);

  it("is the same size as the other buttons, so a row of them is even", () => {
    for (const token of [
      "px-4",
      "py-2",
      "rounded-md",
      "border",
      "font-semibold",
    ]) {
      expect(tokens(dangerButtonClass)).toContain(token);
      expect(tokens(secondaryButtonClass)).toContain(token);
    }
    // And not the small one, which is what made it look out of place.
    for (const small of ["px-2.5", "py-0.5", "text-sm"]) {
      expect(tokens(dangerButtonClass)).not.toContain(small);
    }
  });

  it("is told apart by the danger colors, as the button that deletes the account is", () => {
    for (const token of [
      "border-danger-edge",
      "bg-danger-bg",
      "text-danger-fg",
    ]) {
      expect(tokens(dangerButtonClass)).toContain(token);
    }
    expect(tokens(dangerButtonClass)).not.toContain("bg-accent");
  });

  it("keeps the focus outline and dims when it is disabled", () => {
    expect(dangerButtonClass).toContain("focus-visible:outline-2");
    expect(dangerButtonClass).toContain("disabled:opacity-60");
  });
});

describe("the look of a link", () => {
  it("is the color of the text, semibold, with no underline when it stands on its own, and amber under the pointer and the focus (SAG-114)", () => {
    expect(linkClass).toContain("text-fg");
    expect(linkClass).toContain("font-semibold");
    expect(linkClass).not.toContain("text-accent");
    expect(linkClass).not.toMatch(/(^| )underline( |$)/);
    for (const state of ["hover", "focus-visible"]) {
      expect(linkClass).toContain(`${state}:text-link-hover`);
    }
    // The focus ring of the other controls stays.
    expect(linkClass).toContain("focus-visible:outline-2");
  });

  it("keeps the blue and a thin underline, a little apart from the text, when it is inside a sentence", () => {
    expect(textLinkClass).toContain("text-accent");
    expect(textLinkClass).toMatch(/(^| )underline( |$)/);
    for (const state of ["hover", "focus-visible"]) {
      expect(textLinkClass).toContain(`${state}:text-link-hover`);
    }
    expect(textLinkClass).toContain("focus-visible:outline-2");
    expect(textLinkClass).toContain("decoration-1");
    expect(textLinkClass).toContain("underline-offset-4");
  });

  it("moves softly, and not at all for a person who asked for less motion", () => {
    for (const className of [linkClass, textLinkClass]) {
      expect(className).toContain("transition-colors");
      expect(className).toContain("duration-150");
      expect(className).toContain("motion-reduce:transition-none");
    }
  });

  it("adds an arrow that a screen reader does not read, to the links that go somewhere", () => {
    expect(forwardLinkClass).toContain(linkClass);
    expect(forwardLinkClass).toContain("after:content-['→'_/_'']");
    expect(externalLinkClass).toContain(linkClass);
    expect(externalLinkClass).toContain("after:content-['↗'_/_'']");
    // An inline block, so nothing of the link runs under the arrow.
    expect(forwardLinkClass).toContain("after:inline-block");
    expect(externalLinkClass).toContain("after:inline-block");
    // No arrow inside a sentence.
    expect(textLinkClass).not.toMatch(/[→↗]/);
  });

  it("is not the look of a button", () => {
    for (const className of [linkClass, textLinkClass]) {
      expect(className).not.toContain("bg-accent");
      expect(className).not.toContain("border");
    }
  });
});

describe("the button that deletes, in the pages (SAG-99)", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    });

  // A button is `<button` up to the `>` that closes its tag. The alert boxes use the same colors on
  // a `<p>`, and are not buttons.
  const handWritten =
    /<button\b[^>]*\b(?:bg-danger-bg|text-danger-fg|border-danger-edge)\b/;

  it("all use the shared button, and none writes its colors by hand", () => {
    const own = sources(join(__dirname, ".."))
      .filter((path) => !path.endsWith(join("lib", "ui.ts")))
      .filter((path) => handWritten.test(readFileSync(path, "utf8")));

    expect(own).toEqual([]);
  });

  it("would notice one that does", () => {
    expect(
      handWritten.test(
        '<button type="submit" className="bg-danger-bg text-danger-fg">',
      ),
    ).toBe(true);
    expect(
      handWritten.test('<button type="submit" className={dangerButtonClass}>'),
    ).toBe(false);
    // An alert box, which is not a button.
    expect(
      handWritten.test(
        '<p role="alert" className="border-danger-edge bg-danger-bg text-danger-fg">',
      ),
    ).toBe(false);
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

describe("a link on its own is not drawn as a link inside a sentence (SAG-114)", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
        ? [path]
        : [];
    });

  // The only files that draw the blue link with the underline, and why: each one puts the link
  // inside a sentence (a `Trans` that wraps some words of a paragraph, or a link component that a
  // `Trans` fills). A link on its own (a list, a count, a back link) uses `linkClass`.
  const insideASentence = [
    join("components", "ClerkAuthPage.tsx"),
    join("components", "TvmazeLink.tsx"),
    join("components", "WikidataLink.tsx"),
    join("routes", "account-restricted.tsx"),
    join("routes", "community.tsx"),
    join("routes", "credits.tsx"),
    join("routes", "terms.tsx"),
    join("routes", "media.$type.$slug.tsx"),
  ];

  it("keeps the blue underlined link to the places that put it inside a sentence", () => {
    const root = join(__dirname, "..");
    const users: string[] = [];
    for (const file of sources(root)) {
      if (file.endsWith(join("lib", "ui.ts"))) continue;
      if (readFileSync(file, "utf8").includes("textLinkClass")) {
        users.push(file.slice(root.length + 1));
      }
    }

    expect(users.sort()).toEqual([...insideASentence].sort());
  });
});
