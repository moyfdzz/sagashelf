import { expect, test } from "@playwright/test";

// A signed-in session cannot be made here, so these cover what a visitor and a page on another
// site can do. What a signed-in person can do is covered by the unit and integration tests.

test.describe("the library without a session", () => {
  for (const path of [
    "/library",
    "/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
  ]) {
    test(`${path} is not shown to a visitor`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
      expect([302, 303, 307, 503]).toContain(response.status());
      if (response.status() !== 503) {
        expect(response.headers()["location"]).toMatch(/sign-in|clerk/);
      }
      expect(await response.text()).not.toContain("Mi biblioteca");
    });
  }
});

test.describe("adding a title to the library", () => {
  test("is only for a POST", async ({ request }) => {
    const response = await request.get("/library/add");

    expect(response.status()).toBe(405);
  });

  test("refuses a form sent from another site", async ({ request }) => {
    const response = await request.post("/library/add", {
      headers: { Origin: "https://evil.example" },
      form: { mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test("refuses a body that is too big", async ({ request }) => {
    const response = await request.post("/library/add", {
      form: { mediaId: "x".repeat(5000) },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(413);
  });
});

test.describe("the pages of the library", () => {
  test("are never kept by a shared cache", async ({ request }) => {
    const response = await request.get("/library", { maxRedirects: 0 });

    // A redirect or an error answer must not be kept either.
    expect(response.headers()["cache-control"] ?? "").not.toContain("public");
  });
});
