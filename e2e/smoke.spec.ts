import { expect, test } from "@playwright/test";

test("health endpoint answers 200", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("home page renders", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "SagaShelf" })).toBeVisible();
});

test("unknown URL shows the 404 page", async ({ page }) => {
  const response = await page.goto("/does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});
