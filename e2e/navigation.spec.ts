import { expect, test } from "@playwright/test";

test.use({ locale: "es-MX" });

test("a visitor reaches sign in and sign up from the header", async ({
  page,
}) => {
  await page.goto("/");

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

test.describe("in English", () => {
  test.use({ locale: "en-GB" });

  test("the header is in English", async ({ page }) => {
    await page.goto("/");

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
