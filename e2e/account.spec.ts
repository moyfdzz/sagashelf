import { expect, test } from "@playwright/test";

// A link that acts as a button must not push a page past a 320 px screen (SAG-228). The settings
// page that had the problem needs a session, which this run does not have, so the same link class
// is tried on the page of a restricted account, in both languages.
for (const locale of ["es-MX", "en-US"]) {
  test.describe(`a link that acts as a button, ${locale}`, () => {
    test.use({ locale });

    test("does not scroll sideways at 320 px", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto("/account-restricted");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

// The two routes that act on an account are not pages: they answer only to the form of the
// settings page, with a POST and a session.
for (const path of [
  "/settings/export",
  "/settings/delete",
  "/settings/username",
]) {
  test(`${path} is not a page`, async ({ request }) => {
    const response = await request.get(path);

    expect(response.status()).toBe(405);
  });

  test(`${path} sends a visitor without a session to sign in and does nothing`, async ({
    request,
  }) => {
    const response = await request.post(path, {
      form: { format: "json", confirm: "x", understood: "on" },
      maxRedirects: 0,
    });

    // Never a file and never a success: a redirect to the sign-in page, a refusal, or 503 when
    // the deployment has no Clerk keys (CI has none; the developer's machine has them).
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.headers()["content-disposition"]).toBeUndefined();
  });
}
