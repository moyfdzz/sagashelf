import { describe, expect, it } from "vitest";

import {
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
