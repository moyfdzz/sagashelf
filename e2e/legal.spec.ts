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
        await expect(
          browserPage.getByText("contact@sagashelf.app").first(),
        ).toBeVisible();
      });
    }

    test("the footer links open both pages", async ({ page }) => {
      await page.goto("/");
      const footer = page.getByRole("contentinfo");

      await footer.getByRole("link", { name: pages[0][key].title }).click();
      await expect(page).toHaveURL(/\/privacy$/);

      await page
        .getByRole("contentinfo")
        .getByRole("link", { name: pages[1][key].title })
        .click();
      await expect(page).toHaveURL(/\/terms$/);
    });
  });
}
