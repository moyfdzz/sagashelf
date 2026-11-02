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
