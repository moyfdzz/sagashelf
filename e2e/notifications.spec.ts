import { expect, test } from "@playwright/test";

import { fakeWebhookUrl } from "../server/testing/discord";

// The notifications page (SAG-27) is for a person with a session. A visitor and another site get
// nothing, and nothing is saved or sent: signed-in pages cannot be tried here, so what can be
// shown is that every door in front of them is shut.
const path = "/settings/notifications";

test.describe("the notifications settings", () => {
  test("the page is not shown to a visitor", async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
    expect([302, 303, 307, 503]).toContain(response.status());
    if (response.status() !== 503) {
      expect(response.headers()["location"]).toMatch(/sign-in|clerk/);
    }
    const body = await response.text();
    expect(body).not.toContain("Conectar un canal de Discord");
    expect(body).not.toContain("Notificaciones");
  });

  test("a webhook sent by a visitor, or from another site, saves nothing", async ({
    request,
  }) => {
    const form = { intent: "add", url: fakeWebhookUrl };

    const visitor = await request.post(path, { form, maxRedirects: 0 });
    const otherSite = await request.post(path, {
      form,
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(visitor.status()).toBeGreaterThanOrEqual(300);
    // A refusal. The framework turns a cross-site form away before the action (a 400); the check of the
    // action itself, a 403, is tested in settings.notifications.test.ts.
    expect(otherSite.status()).toBeGreaterThanOrEqual(400);
  });

  test("a message to test a webhook sent by a visitor, or from another site, sends nothing", async ({
    request,
  }) => {
    const form = {
      intent: "test",
      id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
    };

    const visitor = await request.post(path, { form, maxRedirects: 0 });
    const otherSite = await request.post(path, {
      form,
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(visitor.status()).toBeGreaterThanOrEqual(300);
    // A refusal. The framework turns a cross-site form away before the action (a 400); the check of the
    // action itself, a 403, is tested in settings.notifications.test.ts.
    expect(otherSite.status()).toBeGreaterThanOrEqual(400);
  });

  test("refuses a body that is too big, whoever sends it", async ({
    request,
  }) => {
    const response = await request.post(path, {
      form: { intent: "add", url: "x".repeat(5000) },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(413);
  });

  test("is never kept by a shared cache", async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.headers()["cache-control"] ?? "").not.toContain("public");
  });
});
