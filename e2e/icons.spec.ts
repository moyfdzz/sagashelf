import { expect, test } from "@playwright/test";

const icons = [
  { path: "/favicon.svg", type: /image\/svg\+xml/ },
  { path: "/favicon.ico", type: /image\/(x-icon|vnd\.microsoft\.icon)/ },
  { path: "/apple-touch-icon.png", type: /image\/png/ },
  { path: "/icon-512.png", type: /image\/png/ },
];

for (const { path, type } of icons) {
  test(`${path} answers 200 with the right type`, async ({ request }) => {
    const response = await request.get(path);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(type);
  });
}

test("the page declares the icons and the header shows the logo", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.locator('link[rel="icon"][href="/favicon.svg"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('link[rel="icon"][href="/favicon.ico"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]'),
  ).toHaveCount(1);

  const home = page
    .getByRole("banner")
    .getByRole("link", { name: "SagaShelf" });
  await expect(home).toBeVisible();
  await expect(home.locator("svg[aria-hidden='true']")).toBeVisible();
});
