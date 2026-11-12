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

  // An element with a long animation of the app (`toast-in`, which the CSS defines) and a delay,
  // added and measured in one step. The same measure runs with and without the setting, so a test
  // that reads a wrong value, or a keyframe that does not exist, shows up as the first one failing.
  const measure = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const el = document.createElement("div");
      el.style.setProperty("animation", "toast-in 5s 2s infinite");
      el.style.setProperty("transition", "opacity 5s 2s");
      el.style.setProperty("scroll-behavior", "smooth");
      document.body.append(el);
      const style = getComputedStyle(el);
      return {
        duration: style.animationDuration,
        delay: style.animationDelay,
        count: style.animationIterationCount,
        transitionDelay: style.transitionDelay,
        scroll: style.scrollBehavior,
      };
    });

  test("stops the animations, the delays and the smooth scroll of any element", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/privacy");
    const normal = await measure(page);
    // What the test measures is there without the setting: 5 s, 2 s of delay, forever, smooth.
    expect(seconds(normal.duration)).toBe(5);
    expect(seconds(normal.delay)).toBe(2);
    expect(normal.count).toBe("infinite");
    expect(normal.scroll).toBe("smooth");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await measure(page);
    expect(seconds(reduced.duration)).toBeLessThanOrEqual(0.001);
    expect(seconds(reduced.delay)).toBe(0);
    expect(seconds(reduced.transitionDelay)).toBe(0);
    expect(reduced.count).toBe("1");
    expect(reduced.scroll).toBe("auto");
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
