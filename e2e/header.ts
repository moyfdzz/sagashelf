import { expect, type Page } from "@playwright/test";

/** Where the header stops being a menu (`xl` in Tailwind), in pixels. */
const wideScreen = 1280;

/**
 * On a phone the links of the header are in a panel that the "Menu" button shows (SAG-96); on a wide
 * screen they are always there and the button is hidden. This opens the panel when there is one to
 * open, so a test reads the links the same way on both.
 *
 * The page is drawn by the server before it is hydrated, and a click before that does nothing. So
 * the click is repeated, only while the panel is still closed, until the button says it is open.
 */
export async function openMenuIfCollapsed(
  page: Page,
  name: "Menú" | "Menu" = "Menú",
) {
  // The width decides, not whether the button is on screen yet: while a page loads, its style
  // sheet may not be applied, and a button that a wide screen hides would show for a moment.
  const width = page.viewportSize()?.width ?? Infinity;
  if (width >= wideScreen) return;
  const button = page.locator("header").getByRole("button", { name });
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true") {
      await button.click();
    }
    await expect(button).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });
}
