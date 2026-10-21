import { expect, test } from "@playwright/test";

test.describe("language detection", () => {
  test.describe("browser in Mexican Spanish", () => {
    test.use({ locale: "es-MX" });

    test("shows Spanish", async ({ page }) => {
      await page.goto("/");

      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await expect(page.getByRole("link", { name: "Inicio" })).toBeVisible();
    });
  });

  test.describe("browser in British English", () => {
    test.use({ locale: "en-GB" });

    test("shows English", async ({ page }) => {
      await page.goto("/");

      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
    });
  });

  test.describe("browser in an unsupported language", () => {
    test.use({ locale: "fr-FR" });

    test("falls back to Spanish", async ({ page }) => {
      await page.goto("/");

      await expect(page.locator("html")).toHaveAttribute("lang", "es");
    });
  });

  test("the HTML varies by cookie and Accept-Language", async ({ request }) => {
    const response = await request.get("/");

    const vary = response.headers()["vary"] ?? "";
    expect(vary.toLowerCase()).toContain("cookie");
    expect(vary.toLowerCase()).toContain("accept-language");
  });
});

test.describe("language selector", () => {
  test.use({ locale: "es-MX" });

  test("switches the whole page and remembers the choice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Inicio" })).toBeVisible();

    await page.getByRole("button", { name: "English" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.getByRole("button", { name: "Español" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });

  test("the saved choice wins over the browser language", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "English" }).click();

    // The browser still asks for Spanish; the cookie decides.
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("stays on the same page and keeps its status", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByText("Página no encontrada")).toBeVisible();

    await page.getByRole("button", { name: "English" }).click();

    await expect(page).toHaveURL(/\/does-not-exist$/);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("a request from another site cannot change the language", async ({
    request,
  }) => {
    const response = await request.post("/api/locale", {
      form: { locale: "en", redirectTo: "/" },
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });
});
