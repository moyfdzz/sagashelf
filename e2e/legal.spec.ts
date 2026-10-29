import { expect, test } from "@playwright/test";

const pages = [
  {
    path: "/privacy",
    es: { title: "Política de privacidad" },
    en: { title: "Privacy policy" },
  },
  {
    path: "/terms",
    es: { title: "Términos de uso" },
    en: { title: "Terms of use" },
  },
  {
    path: "/community",
    es: { title: "Reglas de la comunidad" },
    en: { title: "Community rules" },
  },
  {
    path: "/credits",
    es: { title: "Créditos" },
    en: { title: "Credits" },
  },
];

for (const [locale, key] of [
  ["es-MX", "es"],
  ["en-US", "en"],
] as const) {
  test.describe(`legal pages in ${locale}`, () => {
    test.use({ locale });

    for (const page of pages) {
      test(`${page.path} answers 200 with its heading and the contact address`, async ({
        page: browserPage,
      }) => {
        const response = await browserPage.goto(page.path);

        expect(response?.status()).toBe(200);
        await expect(
          browserPage.getByRole("heading", {
            level: 1,
            name: page[key].title,
          }),
        ).toBeVisible();
        if (page.path !== "/credits") {
          await expect(
            browserPage.getByText("contact@sagashelf.app").first(),
          ).toBeVisible();
        }
      });
    }

    test("the footer links open every legal page", async ({ page }) => {
      for (const target of pages) {
        await page.goto("/");
        await page
          .getByRole("contentinfo")
          .getByRole("link", { name: target[key].title })
          .click();
        await expect(page).toHaveURL(new RegExp(`${target.path}$`));
      }
    });

    test("the privacy policy names the title sources and the library", async ({
      page,
    }) => {
      await page.goto("/privacy");

      const main = page.getByRole("main");
      await expect(main.getByText("TMDB, Open Library")).toBeVisible();
      await expect(main.getByText(/Biblioteca:|Library:/)).toBeVisible();
    });

    test("the terms link to the credits for the title data", async ({
      page,
    }) => {
      await page.goto("/terms");

      await page
        .getByRole("main")
        .getByRole("link", { name: /Créditos|Credits/ })
        .click();
      await expect(page).toHaveURL(/\/credits$/);
    });

    test("the credits page credits MangaDex with a link back", async ({
      page,
    }) => {
      await page.goto("/credits");

      await expect(
        page.getByRole("main").getByRole("link", { name: "MangaDex" }),
      ).toHaveAttribute("href", "https://mangadex.org/");
    });

    test("the credits page credits Open Library with a link back", async ({
      page,
    }) => {
      await page.goto("/credits");

      await expect(
        page.getByRole("main").getByRole("link", { name: "Open Library" }),
      ).toHaveAttribute("href", "https://openlibrary.org/");
    });

    test("the credits page shows the TMDB logo, its notice and the cookies link", async ({
      page,
    }) => {
      await page.goto("/credits");

      await expect(
        page.getByRole("img", { name: "The Movie Database (TMDB)" }),
      ).toBeVisible();
      // The notice is in English in both languages, so it says so to screen readers.
      await expect(
        page.locator("p[lang=en]", {
          hasText:
            "This product uses the TMDB API but is not endorsed or certified by TMDB.",
        }),
      ).toBeVisible();
      if (key === "es") {
        await expect(page.getByText("Traducción de cortesía")).toBeVisible();
      }

      await page
        .getByRole("main")
        .getByRole("link", { name: /privacy|privacidad/i })
        .click();
      await expect(page).toHaveURL(/\/privacy#cookies$/);
    });
  });
}
