import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The skip link (SAG-256): the first Tab stop of every page, which jumps the header to the content.
// It runs on both projects: on a phone the header is collapsed, and the link still comes first.

for (const [locale, text] of [
  ["es-MX", "Saltar al contenido"],
  ["en-US", "Skip to content"],
] as const) {
  test.describe(locale, () => {
    test.use({ locale });

    test("is the first stop of the page, shows when it has the focus, and says so in the language", async ({
      page,
    }) => {
      await page.goto("/search");
      await page.waitForLoadState("networkidle");
      const link = page.getByRole("link", { name: text });

      // Hidden before the focus: it takes no room on the page.
      const hidden = await link.boundingBox();
      expect(hidden?.width ?? 0).toBeLessThanOrEqual(1);

      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      const shown = await link.boundingBox();
      expect(shown?.width).toBeGreaterThan(80);
      expect(shown?.x).toBeGreaterThanOrEqual(0);
      expect(shown?.y).toBeGreaterThanOrEqual(0);
    });

    test("is readable when it shows: no accessibility violation with the focus on it", async ({
      page,
    }) => {
      await page.goto("/privacy");
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: text })).toBeFocused();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  });
}

test.describe("using it", () => {
  test.use({ locale: "es-MX" });

  test("Enter moves the focus to the main landmark of the page, with no ring and no change of the address, and the next Tab is a control of the content, not of the header", async ({
    page,
  }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    // A landmark, which a screen reader announces, and the address is left alone.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      "MAIN",
    );
    expect(page.url()).not.toContain("#");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.activeElement as Element).outlineStyle,
      ),
    ).toBe("none");

    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => ({
        inMain: document.activeElement?.closest("main") !== null,
        inHeader: document.activeElement?.closest("header") !== null,
      })),
    ).toEqual({ inMain: true, inHeader: false });
  });

  test("is the first stop on every page that needs no session, and the target is there", async ({
    page,
  }) => {
    for (const path of ["/", "/privacy", "/terms", "/community", "/credits"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("Tab");
      const first = await page.evaluate(() => ({
        href: document.activeElement?.getAttribute("href"),
        target: document.getElementById("content")?.tagName,
      }));
      expect(first, path).toEqual({ href: "#content", target: "DIV" });
    }
  });

  test("works without JavaScript: the anchor takes the browser to the content", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      locale: "es-MX",
    });
    const page = await context.newPage();
    await page.goto("/privacy");
    // The link is for the keyboard: it is hidden until it has the focus, so it is pressed with it.
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al contenido" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/privacy#content$/);
    await context.close();
  });
});
