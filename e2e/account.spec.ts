import { expect, test } from "@playwright/test";

import { wrappingSecondaryLinkClass } from "../app/lib/ui";

// A long link that acts as a button must not push a page past a 320 px screen (SAG-228). The
// settings page that had the problem needs a session, which this run does not have, so the real
// class of that link is put on a public page, inside the same `main` padding, with the same long
// Spanish label (325 px on one line) and measured there.
test.describe("a long link that acts as a button", () => {
  test.use({ locale: "es-MX" });

  const labels = {
    "a long label": "Importar mi biblioteca desde un archivo",
    "one long word": "Importarmibibliotecadesdeunarchivoenunsoloformato".repeat(
      2,
    ),
  };

  for (const [name, label] of Object.entries(labels)) {
    test(`does not scroll sideways at 320 px, with ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto("/account-restricted");
      await page.evaluate(
        ({ className, text }) => {
          const link = document.createElement("a");
          link.href = "/settings/import";
          link.className = className;
          link.textContent = text;
          document.querySelector("main")?.appendChild(link);
        },
        { className: wrappingSecondaryLinkClass, text: label },
      );

      // Without the link there is nothing to measure, so a missing link must fail the test.
      await expect(
        page.locator('main a[href="/settings/import"]'),
      ).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

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
