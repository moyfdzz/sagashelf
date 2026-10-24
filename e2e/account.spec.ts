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

    // A redirect to the sign-in page (or a refusal), never a file and never a deletion.
    expect([302, 303, 401, 403]).toContain(response.status());
    expect(response.headers()["content-disposition"]).toBeUndefined();
  });
}
