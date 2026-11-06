import { expect, test } from "@playwright/test";

import { openMenuIfCollapsed } from "./header";

test.use({ locale: "es-MX" });

test("a visitor reaches sign in and sign up from the header", async ({
  page,
}) => {
  await page.goto("/");
  await openMenuIfCollapsed(page);

  const header = page.locator("header");
  await expect(
    header.getByRole("link", { name: "Iniciar sesión" }),
  ).toHaveAttribute("href", "/sign-in");
  await expect(
    header.getByRole("link", { name: "Crear cuenta" }),
  ).toHaveAttribute("href", "/sign-up");
  // The account menu is only for a person with a session.
  await expect(header.getByRole("button", { name: "Cuenta" })).toHaveCount(0);
});

test("a visitor sees no links that need a session in the header", async ({
  page,
}) => {
  await page.goto("/");
  await openMenuIfCollapsed(page);

  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Buscar" })).toBeVisible();
  for (const name of ["Mi biblioteca", "Estadísticas", "Recomendaciones"]) {
    await expect(header.getByRole("link", { name })).toHaveCount(0);
  }
});

test.describe("the menu of a phone", () => {
  test("shows the links in a panel that Escape, a click outside and a new route close", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Only phones have the panel");
    await page.goto("/");

    const header = page.locator("header");
    const button = header.getByRole("button", { name: "Menú" });
    const search = header.getByRole("link", { name: "Buscar" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(search).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(search).toBeVisible();
    await expect(header.getByRole("link", { name: "Inicio" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await expect(search).toBeHidden();

    await button.click();
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // The link is the router's: no new document, so the panel has to close by itself.
    await button.click();
    await search.click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("does not scroll sideways, open or closed", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Only phones have the panel");
    await page.goto("/");

    const overflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.locator("header").getByRole("button", { name: "Menú" }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("keeps the footer at the bottom of the screen on a short page (SAG-139)", async ({
    page,
  }) => {
    const { width } = page.viewportSize() ?? { width: 1280 };
    await page.setViewportSize({ width, height: 4000 });
    await page.goto("/credits");

    const footer = await page.locator("footer").boundingBox();

    expect(footer).not.toBeNull();
    expect(Math.round((footer?.y ?? 0) + (footer?.height ?? 0))).toBe(4000);
  });

  test("keeps the footer after the content on a long page (SAG-139)", async ({
    page,
  }) => {
    const { width } = page.viewportSize() ?? { width: 1280 };
    await page.setViewportSize({ width, height: 400 });
    await page.goto("/privacy");

    const footer = await page.locator("footer").boundingBox();
    const main = await page.locator("main").boundingBox();
    const pageHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );

    expect(footer?.y ?? 0).toBeGreaterThan(400);
    expect(footer?.y ?? 0).toBeGreaterThanOrEqual(
      (main?.y ?? 0) + (main?.height ?? 0),
    );
    expect(Math.round((footer?.y ?? 0) + (footer?.height ?? 0))).toBe(
      pageHeight,
    );
  });

  test("keeps the name, the language, the theme and the menu in one row, and opens the panel right under the button (SAG-104)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Only phones have the panel");
    await page.goto("/");

    const header = page.locator("header");
    const box = async (locator: ReturnType<typeof header.locator>) => {
      const found = await locator.boundingBox();
      if (!found) throw new Error("An element of the header has no box");
      return found;
    };
    const logo = await box(header.getByRole("link", { name: "SagaShelf" }));
    const language = await box(header.getByRole("group", { name: "Idioma" }));
    const theme = await box(
      header.getByRole("switch", { name: "Modo oscuro" }),
    );
    const button = header.getByRole("button", { name: "Menú" });
    const menu = await box(button);

    // One row: the middle of each piece is at the height of the middle of the logo.
    for (const piece of [language, theme, menu]) {
      expect(
        Math.abs(piece.y + piece.height / 2 - (logo.y + logo.height / 2)),
      ).toBeLessThan(12);
    }
    // In order, left to right, and the name of the app is not squeezed.
    expect(logo.x + logo.width).toBeLessThanOrEqual(language.x);
    expect(language.x + language.width).toBeLessThanOrEqual(theme.x);
    expect(theme.x + theme.width).toBeLessThanOrEqual(menu.x);
    expect(logo.width).toBeGreaterThanOrEqual(145);
    // A phone of 412 px has room for the icon only; the word stays as the name of the button.
    expect(menu.width).toBeLessThan(50);
    expect(menu.height).toBeGreaterThanOrEqual(36);

    await openMenuIfCollapsed(page);
    const id = await button.getAttribute("aria-controls");
    const panel = await box(page.locator(`[id="${id}"]`));
    // Right under the button, as if it came out of it, aligned to its right edge, inside the screen.
    expect(Math.abs(panel.y - (menu.y + menu.height + 8))).toBeLessThanOrEqual(
      2,
    );
    expect(
      Math.abs(panel.x + panel.width - (menu.x + menu.width)),
    ).toBeLessThanOrEqual(2);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
  });

  test("is not there on a wide screen, where the links are in the bar", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Only wide screens");
    await page.goto("/");

    const header = page.locator("header");
    await expect(header.getByRole("button", { name: "Menú" })).toBeHidden();
    await expect(header.getByRole("link", { name: "Buscar" })).toBeVisible();
  });
});

test("the language buttons say ES and EN on a phone and the whole word on a wide screen, and are named by the word (SAG-104)", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const header = page.locator("header");
  // `useInnerText`: what a person sees, not the text of the hidden span next to it.
  const phone = testInfo.project.name === "mobile";
  await expect(header.getByRole("button", { name: "Español" })).toHaveText(
    phone ? "ES" : "Español",
    { useInnerText: true },
  );
  await expect(header.getByRole("button", { name: "English" })).toHaveText(
    phone ? "EN" : "English",
    { useInnerText: true },
  );
});

test.describe("in English", () => {
  test.use({ locale: "en-GB" });

  test("the header is in English", async ({ page }) => {
    await page.goto("/");
    await openMenuIfCollapsed(page, "Menu");

    await expect(
      page.locator("header").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
  });
});

test("pages differ by session, so a shared cache must not keep them", async ({
  request,
}) => {
  const response = await request.get("/");

  expect(response.headers()["cache-control"]).toContain("private");
});

test("/sign-out is not an action: it only answers a page request", async ({
  request,
}) => {
  const response = await request.post("/sign-out", { maxRedirects: 0 });

  // Nothing to post to: a refusal, or 503 when the deployment has no Clerk keys.
  expect(response.status()).toBeGreaterThanOrEqual(400);
});
