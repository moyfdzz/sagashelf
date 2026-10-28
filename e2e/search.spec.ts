import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ locale: "es-MX" });

test("the search page asks for a term and has the type tabs", async ({
  page,
}) => {
  await page.goto("/search");

  await expect(page.getByRole("heading", { name: "Buscar" })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByText("Escribe al menos 2 letras")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Tipo de título" });
  for (const name of ["Todo", "Anime", "Películas", "Series"]) {
    await expect(tabs.getByRole("link", { name })).toBeVisible();
  }
  // Books and manga come with their providers, not before.
  await expect(tabs.getByRole("link", { name: "Libros" })).toHaveCount(0);
});

test("a search works without JavaScript: the form sends q and the type", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: "es-MX",
  });
  const page = await context.newPage();
  await page.goto("/search?type=anime");

  await page.getByRole("combobox").fill("titanes");
  await page.getByRole("button", { name: "Buscar" }).click();

  await expect(page).toHaveURL(
    /\/search\?type=anime&q=titanes|q=titanes&type=anime/,
  );
  await context.close();
});

test("the active tab keeps the search text", async ({ page }) => {
  await page.goto("/search?q=dune");

  await page
    .getByRole("navigation", { name: "Tipo de título" })
    .getByRole("link", { name: "Series" })
    .click();

  await expect(page).toHaveURL(/q=dune/);
  await expect(page).toHaveURL(/type=series/);
  await expect(
    page
      .getByRole("navigation", { name: "Tipo de título" })
      .getByRole("link", { name: "Series" }),
  ).toHaveAttribute("aria-current", "page");
});

test("a search with no results says so", async ({ page }) => {
  // Nonsense that no title, in the database or at TMDB, can match: the same answer with or
  // without a database and a TMDB token on the test server.
  await page.goto("/search?q=qzxwvkjhgfdsa");

  await expect(page.getByText("No encontramos resultados")).toBeVisible();
});

test("a query that is too long is refused with a message", async ({ page }) => {
  await page.goto(`/search?q=${"x".repeat(150)}`);

  await expect(page.getByText("demasiado larga")).toBeVisible();
});

test("a type that is not ours means all of them", async ({ page }) => {
  // Manga is not searched yet, so its type is not one of ours.
  await page.goto("/search?q=dune&type=manga");

  await expect(
    page
      .getByRole("navigation", { name: "Tipo de título" })
      .getByRole("link", { name: "Todo" }),
  ).toHaveAttribute("aria-current", "page");
});

test("the page is not for search engines and not kept by shared caches", async ({
  request,
}) => {
  const response = await request.get("/search?q=dune");

  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.text()).toContain("noindex");
});

test("the search page has no accessibility violations", async ({ page }) => {
  await page.goto("/search?q=dune");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("the search page does not scroll sideways", async ({ page }) => {
  await page.goto("/search?q=dune");

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});

test("the header links to the search", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Buscar" })
    .click();

  await expect(page).toHaveURL(/\/search$/);
});
