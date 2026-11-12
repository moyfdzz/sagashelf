import { expect, test, type Page } from "@playwright/test";

// The keyboard on the real pages that need no session (SAG-251): the order of the focus, a visible
// ring on every stop, no trap, and the switches of the header. The wide screen is where the header
// shows all its controls; the phone panel is tested in `navigation.spec.ts`.

test.use({ locale: "es-MX" });

test.skip(
  ({ isMobile }) => isMobile,
  "The phone hides the header controls in a panel; navigation.spec.ts covers it",
);

type Stop = {
  tag: string;
  name: string;
  outlineStyle: string;
  outlineWidth: number;
  /** Whether the stop comes after the one before it in the document. */
  inOrder: boolean;
  region: string;
};

/** Presses Tab until the focus leaves the document, and describes every stop on the way. */
async function tabThrough(page: Page, limit = 60): Promise<Stop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: Stop[] = [];
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const w = window as unknown as { __previousStop?: Element };
      const before = w.__previousStop;
      w.__previousStop = el;
      return {
        tag: el.tagName.toLowerCase(),
        name: (
          el.getAttribute("aria-label") ||
          el.innerText ||
          el.getAttribute("href") ||
          el.getAttribute("name") ||
          ""
        )
          .trim()
          .slice(0, 40),
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
        inOrder:
          !before ||
          Boolean(
            before.compareDocumentPosition(el) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        region: el.closest("header")
          ? "header"
          : el.closest("footer")
            ? "footer"
            : "main",
      };
    });
    if (!stop) break;
    stops.push(stop);
  }
  return stops;
}

for (const path of ["/", "/search", "/privacy", "/contact"]) {
  test.describe(`the page ${path}`, () => {
    test("is crossed with Tab in the order of the page, with no trap, and leaves the document", async ({
      page,
    }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const stops = await tabThrough(page);

      // The focus left the document before the limit: nothing holds it.
      expect(stops.length, "the focus never left the page").toBeLessThan(60);
      expect(stops.length).toBeGreaterThan(3);
      // The order of the focus is the order of the page: nothing jumps back.
      for (const [index, stop] of stops.entries()) {
        expect(
          stop.inOrder,
          `stop ${index + 1}: ${stop.tag} ${stop.name}`,
        ).toBe(true);
      }
      // It goes header, then content, then footer.
      const regions = stops.map((stop) => stop.region);
      expect(regions[0]).toBe("header");
      expect(regions.at(-1)).toBe("footer");
      expect(regions.join(",")).not.toMatch(/main,header|footer,main/);
    });

    test("shows a ring on every control it stops on", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const stops = await tabThrough(page);

      for (const stop of stops) {
        expect(
          stop.outlineStyle !== "none" && stop.outlineWidth > 0,
          `no ring on ${stop.tag} "${stop.name}"`,
        ).toBe(true);
      }
    });
  });
}

test.describe("the switches of the header, with the keyboard", () => {
  test("the dark mode switch changes with Enter and with Space, and says so", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("networkidle");
    const toggle = page.getByRole("switch", { name: "Modo oscuro" });
    await toggle.focus();
    const before = await toggle.getAttribute("aria-checked");

    for (const key of ["Enter", "Space"]) {
      const was = await toggle.getAttribute("aria-checked");
      await page.keyboard.press(key);
      await expect(toggle).not.toHaveAttribute("aria-checked", was ?? "");
      await expect(toggle).toBeFocused();
    }
    // Two presses: back where it was.
    await expect(toggle).toHaveAttribute("aria-checked", before ?? "");
  });

  test("a language is chosen with Enter, and the page says its language", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("networkidle");
    const english = page.getByRole("button", { name: "English" });
    await english.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
