import { expect, test } from "@playwright/test";

// The tracker of the analytics is off unless `ANALYTICS_ENABLED=true` (SAG-24, ADR-050), and CI and
// the previews never set it. So no public page may call the collector: nothing is measured until the
// owner turns it on, once the privacy policy says what is measured.

test.use({ locale: "es-MX" });

const pages = ["/", "/search?q=naruto", "/privacy", "/credits", "/nowhere"];

for (const path of pages) {
  test(`${path} does not call the collector while the analytics are off`, async ({
    page,
  }) => {
    const calls: string[] = [];
    page.context().on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/collect") {
        calls.push(request.url());
      }
    });

    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Long enough for a time on the page (a second or more) to have been sent, if it were on.
    await page.waitForTimeout(1500);
    await page.goto("about:blank");

    expect(calls).toEqual([]);
  });
}
