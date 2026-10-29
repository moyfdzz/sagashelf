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

test.describe("importing the library", () => {
  test("the page is not shown to a visitor", async ({ request }) => {
    const response = await request.get("/settings/import", { maxRedirects: 0 });

    // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
    expect([302, 303, 307, 503]).toContain(response.status());
    if (response.status() !== 503) {
      expect(response.headers()["location"]).toMatch(/sign-in|clerk/);
    }
    expect(await response.text()).not.toContain("Importar tu biblioteca");
  });

  test("a file sent by a visitor, or from another site, writes nothing", async ({
    request,
  }) => {
    const file = {
      name: "sagashelf.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ schemaVersion: 1, libraryEntries: [] }),
      ),
    };
    const visitor = await request.post("/settings/import", {
      multipart: { intent: "preview", file },
      maxRedirects: 0,
    });
    const otherSite = await request.post("/settings/import", {
      multipart: { intent: "preview", file },
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(visitor.status()).toBeGreaterThanOrEqual(300);
    expect(otherSite.status()).toBeGreaterThanOrEqual(400);
  });
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

test.describe("the quick +1 of the library", () => {
  const path = "/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f/step";

  test("is only for a POST", async ({ request }) => {
    const response = await request.get(path);

    expect(response.status()).toBe(405);
  });

  test("refuses a form sent from another site", async ({ request }) => {
    const response = await request.post(path, {
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test("refuses a body that is too big", async ({ request }) => {
    const response = await request.post(path, {
      form: { x: "x".repeat(5000) },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(413);
  });

  test("is not for a visitor", async ({ request }) => {
    const response = await request.post(path, { maxRedirects: 0 });

    // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
    expect([302, 303, 307, 401, 503]).toContain(response.status());
    expect(await response.text()).not.toContain('"ok":true');
  });
});

test.describe("the quick status of the library", () => {
  const path = "/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f/status";

  test("is only for a POST", async ({ request }) => {
    const response = await request.get(path);

    expect(response.status()).toBe(405);
  });

  test("refuses a form sent from another site", async ({ request }) => {
    const response = await request.post(path, {
      headers: { Origin: "https://evil.example" },
      form: { status: "paused" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test("refuses a body that is too big", async ({ request }) => {
    const response = await request.post(path, {
      form: { status: "x".repeat(5000) },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(413);
  });

  test("is not for a visitor", async ({ request }) => {
    const response = await request.post(path, {
      form: { status: "paused" },
      maxRedirects: 0,
    });

    // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
    expect([302, 303, 307, 401, 503]).toContain(response.status());
    expect(await response.text()).not.toContain('"ok":true');
  });
});

test.describe("adding a title from the title page with JavaScript", () => {
  test("sends a visitor to sign in, and never answers that it added", async ({
    request,
  }) => {
    const response = await request.post("/library/add", {
      headers: { "Sec-Fetch-Dest": "empty" },
      form: { mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f" },
      maxRedirects: 0,
    });

    expect([302, 303, 307, 401, 503]).toContain(response.status());
    expect(await response.text()).not.toContain('"ok":true');
  });
});

test.describe("adding a result of the search", () => {
  const path = "/library/add-external";
  const form = { provider: "tmdb", id: "tv/250307" };

  test("is only for a POST", async ({ request }) => {
    const response = await request.get(path);

    expect(response.status()).toBe(405);
  });

  test("refuses a form sent from another site", async ({ request }) => {
    const response = await request.post(path, {
      headers: { Origin: "https://evil.example", "Sec-Fetch-Dest": "empty" },
      form,
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test("refuses a body that is too big", async ({ request }) => {
    const response = await request.post(path, {
      headers: { "Sec-Fetch-Dest": "empty" },
      form: { ...form, id: "x".repeat(5000) },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(413);
  });

  test("sends a visitor to sign in, with a fetch or a document, and saves nothing", async ({
    request,
  }) => {
    for (const dest of ["empty", "document"]) {
      const response = await request.post(path, {
        headers: { "Sec-Fetch-Dest": dest },
        form,
        maxRedirects: 0,
      });

      // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
      expect([302, 303, 307, 401, 503]).toContain(response.status());
      expect(await response.text()).not.toContain('"ok":true');
    }
  });
});

test.describe("the pages of the library", () => {
  test("are never kept by a shared cache", async ({ request }) => {
    const response = await request.get("/library", { maxRedirects: 0 });

    // A redirect or an error answer must not be kept either.
    expect(response.headers()["cache-control"] ?? "").not.toContain("public");
  });
});
