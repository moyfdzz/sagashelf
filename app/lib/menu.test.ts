import { describe, expect, it } from "vitest";

import { menuAlign, menuPanelWidth } from "./menu";

describe("menuAlign (SAG-95)", () => {
  it("hangs the panel from the right edge of the button when it fits to its left", () => {
    // A button at the right of a 1280 px header, and one at the right of a tablet.
    expect(menuAlign(1264)).toBe("right");
    expect(menuAlign(700)).toBe("right");
  });

  it("opens it to the right of the button on a phone, where the button is at the left", () => {
    // The button of a 390 px header ends 116 px from the left of the window.
    expect(menuAlign(116)).toBe("left");
    expect(menuAlign(0)).toBe("left");
  });

  it("keeps the margin: a panel that would touch the edge of the window opens the other way", () => {
    expect(menuAlign(menuPanelWidth + 8)).toBe("right");
    expect(menuAlign(menuPanelWidth + 7)).toBe("left");
  });

  it("takes the width and the margin it is given", () => {
    expect(menuAlign(300, 200, 50)).toBe("right");
    expect(menuAlign(240, 200, 50)).toBe("left");
  });
});
