import { expect, test } from "@playwright/test";

// None of these reach the database or a provider, so they pass the same way in CI and locally.

test.use({ locale: "es-MX" });

test.describe("the image proxy", () => {
  for (const path of [
    "/img/evil/w342/a.jpg",
    "/img/tmdb/original/a.jpg",
    "/img/tmdb/w342/a.svg",
    "/img/tmdb/w342/..%2F..%2Fa.jpg",
    "/img/tmdb/w342/a.jpg%3Fx=1",
  ]) {
    test(`refuses ${path} without calling anyone`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(404);
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect(response.headers()["cache-control"]).toBe("no-store");
      // The security headers of every Worker response are there too.
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    });
  }
});

test.describe("opening a title", () => {
  for (const query of [
    "",
    "?provider=evil&id=movie%2F1",
    "?provider=tmdb&id=..%2F..%2Fx%3Fy%3D1",
  ]) {
    test(`answers 400 for ${query || "no parameters"}`, async ({ request }) => {
      const response = await request.get(`/media/open${query}`, {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(400);
    });
  }

  test("answers 404 for an address that holds no id", async ({ page }) => {
    const response = await page.goto("/media/movie/matrix");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Página no encontrada" }),
    ).toBeVisible();
  });

  test("answers 404 for a saga address that is not a slug, before it reads the database (SAG-25)", async ({
    page,
  }) => {
    const response = await page.goto("/sagas/Not_A_Slug");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Página no encontrada" }),
    ).toBeVisible();
  });

  test("keeps crawlers away from the address that saves a title", async ({
    request,
  }) => {
    const robots = await (await request.get("/robots.txt")).text();

    expect(robots).toContain("Disallow: /media/open");
  });
});
