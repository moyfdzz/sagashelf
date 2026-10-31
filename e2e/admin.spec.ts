import { expect, test } from "@playwright/test";

// A signed-in administrator cannot be made here, so these cover what a visitor and a page on
// another site can do. What an administrator can do is covered by the unit and integration tests.

const saga = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

test.describe("the administration of the sagas without a session", () => {
  for (const path of ["/admin/sagas", `/admin/sagas/${saga}`]) {
    test(`${path} is not shown to a visitor`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
      expect([302, 303, 307, 503]).toContain(response.status());
      if (response.status() !== 503) {
        expect(response.headers()["location"]).toMatch(/sign-in|clerk/);
      }
      const body = await response.text();
      expect(body).not.toContain("Crear una saga");
      expect(body).not.toContain("Create a saga");
    });
  }

  test("a change sent by a visitor, or from another site, writes nothing", async ({
    request,
  }) => {
    const form = { intent: "publish" };
    const visitor = await request.post(`/admin/sagas/${saga}`, {
      form,
      maxRedirects: 0,
    });
    const otherSite = await request.post(`/admin/sagas/${saga}`, {
      form,
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });
    const create = await request.post("/admin/sagas", {
      form: { intent: "create", titleEs: "x", titleEn: "x" },
      maxRedirects: 0,
    });

    // A redirect to sign in, a refusal, or no answer at all: never a saved change.
    expect(visitor.status()).toBeGreaterThanOrEqual(300);
    expect(otherSite.status()).toBeGreaterThanOrEqual(400);
    expect(create.status()).toBeGreaterThanOrEqual(300);
  });

  test("no page offers the link to the administration to a visitor (SAG-95)", async ({
    request,
  }) => {
    for (const path of ["/", "/search", "/credits"]) {
      const body = await (await request.get(path)).text();

      expect(body, path).not.toContain("/admin/sagas");
      expect(body, path).not.toContain("Administración");
      expect(body, path).not.toContain("Administration");
    }
  });

  test("keeps crawlers away from the administration", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();

    expect(robots).toContain("Disallow: /admin");
  });
});
