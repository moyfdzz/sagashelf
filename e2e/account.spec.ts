import { expect, test } from "@playwright/test";

// The two routes that act on an account are not pages: they answer only to the form of the
// settings page, with a POST and a session.
for (const path of ["/settings/export", "/settings/delete"]) {
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
