import { expect, test } from "@playwright/test";

// A person who asked for less motion gets none, and the controls of the header have a size to press
// (SAG-252). The first test reads the computed style, so it holds for every element, now and later.

test.use({ locale: "es-MX" });

const seconds = (text: string) => parseFloat(text.split(",")[0] ?? "0");

test.describe("reduced motion", () => {
  const transitionOfSwitch = (page: import("@playwright/test").Page) =>
    page
      .getByRole("switch", { name: "Modo oscuro" })
      .evaluate((el) => getComputedStyle(el).transitionDuration);

  test("makes the transitions of the app last almost nothing", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/privacy");

    expect(seconds(await transitionOfSwitch(page))).toBeLessThanOrEqual(0.001);
  });

  test("leaves them as they are for anyone who did not ask", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/privacy");

    expect(seconds(await transitionOfSwitch(page))).toBeGreaterThanOrEqual(0.1);
  });

  test("stops the smooth scroll and the animations of any element", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/privacy");
    // One element with a long animation and a smooth scroll, added and measured in one step.
    const result = await page.evaluate(() => {
      const el = document.createElement("div");
      el.style.setProperty("animation", "spin 5s infinite");
      el.style.setProperty("scroll-behavior", "smooth");
      document.body.append(el);
      const style = getComputedStyle(el);
      return {
        duration: style.animationDuration,
        count: style.animationIterationCount,
        scroll: style.scrollBehavior,
      };
    });

    expect(seconds(result.duration)).toBeLessThanOrEqual(0.001);
    expect(result.count).toBe("1");
    expect(result.scroll).toBe("auto");
  });
});

test.describe("the switches of the header", () => {
  test("are at least 40 px high, and the dark mode switch 40 px wide too", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("networkidle");

    const theme = await page
      .getByRole("switch", { name: "Modo oscuro" })
      .boundingBox();
    expect(theme?.width).toBeGreaterThanOrEqual(40);
    expect(theme?.height).toBeGreaterThanOrEqual(40);

    for (const name of ["Español", "English"]) {
      const language = await page.getByRole("button", { name }).boundingBox();
      expect(language?.height, name).toBeGreaterThanOrEqual(40);
      // The width of the code or the word is not stretched; the floor of WCAG 2.2 is 24 px.
      expect(language?.width, name).toBeGreaterThanOrEqual(24);
    }
  });
});
