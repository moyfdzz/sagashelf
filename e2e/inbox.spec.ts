import { expect, test } from "@playwright/test";

// The inbox of notifications (SAG-102) is for a person with a session. Signed-in pages cannot be
// tried here, so what can be shown is that every door in front of it is shut.
const path = "/notifications";

test.describe("the inbox of notifications", () => {
  test("the page is not shown to a visitor", async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
    expect([302, 303, 307, 503]).toContain(response.status());
    if (response.status() !== 503) {
      expect(response.headers()["location"]).toMatch(/sign-in|clerk/);
    }
    const body = await response.text();
    expect(body).not.toContain("No tienes avisos sin leer");
    expect(body).not.toContain("Marcar como leído");
  });

  test("marking an alert as read, sent by a visitor or from another site, marks nothing", async ({
    request,
  }) => {
    const form = {
      intent: "read",
      id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
    };

    const visitor = await request.post(path, { form, maxRedirects: 0 });
    const otherSite = await request.post(path, {
      form,
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(visitor.status()).toBeGreaterThanOrEqual(300);
    // A refusal. The framework turns a cross-site form away before the action (a 400); the check of
    // the action itself, a 403, is tested in notifications.test.ts.
    expect(otherSite.status()).toBeGreaterThanOrEqual(400);
  });

  test("the answer to a visitor is never kept by a shared cache", async ({
    request,
  }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.headers()["cache-control"] ?? "").not.toMatch(/public/);
  });
});
