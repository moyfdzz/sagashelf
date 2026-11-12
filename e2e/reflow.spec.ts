import { expect, test } from "@playwright/test";

// Zoom without sideways scrolling (SAG-251). A 1280 px window at 200% zoom is 640 CSS pixels wide and
// at 400% it is 320 (WCAG 1.4.10 asks for no sideways scroll at 320). Playwright has no browser zoom,
// so the width is what is set. Large text on its own is the third case: the root font size at 200% on
// 320 px (SAG-257).

test.use({ locale: "es-MX" });

const pages = [
  "/",
  "/search",
  "/privacy",
  "/terms",
  "/community",
  "/credits",
  "/contact",
  "/does-not-exist",
];

const cases = [
  { name: "200% zoom (640 px)", width: 640, fontSize: null },
  { name: "400% zoom (320 px)", width: 320, fontSize: null },
  { name: "text at 200% (320 px)", width: 320, fontSize: "200%" },
];

for (const { name, width, fontSize } of cases) {
  test.describe(name, () => {
    test.use({ viewport: { width, height: 800 } });

    // A person with a large system font has a bigger root font size, not a zoom.
    test.beforeEach(async ({ page }) => {
      if (fontSize) {
        await page.addInitScript((size) => {
          document.addEventListener("DOMContentLoaded", () => {
            document.documentElement.style.fontSize = size;
          });
        }, fontSize);
      }
    });

    for (const path of pages) {
      test(`${path} does not scroll sideways`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
