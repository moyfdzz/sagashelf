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

    test("the credits page shows the TMDB logo, its notice and the cookies link", async ({
      page,
    }) => {
      await page.goto("/credits");

      await expect(
        page.getByRole("img", { name: "The Movie Database (TMDB)" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "This product uses the TMDB API but is not endorsed or certified by TMDB.",
        ),
      ).toBeVisible();

      await page
        .getByRole("main")
        .getByRole("link", { name: /privacy|privacidad/i })
        .click();
      await expect(page).toHaveURL(/\/privacy#cookies$/);
    });
  });
}
