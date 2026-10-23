import { expect, test } from "@playwright/test";

// Only the production build sends the CSP (the dev server needs scripts it cannot sign).
// CI runs the production build, so these tests run there.
const productionBuild = !!process.env.CI;

const baseHeaders = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

test.describe("security headers", () => {
  test("JSON responses carry the base headers and a locked-down CSP", async ({
    request,
  }) => {
    const headers = (await request.get("/api/health")).headers();

    for (const [name, value] of Object.entries(baseHeaders)) {
      expect(headers[name], name).toBe(value);
    }
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  for (const path of [
    "/favicon.ico",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/icon-512.png",
  ]) {
    test(`static file ${path} carries the base headers too`, async ({
      request,
    }) => {
      const headers = (await request.get(path)).headers();

      for (const [name, value] of Object.entries(baseHeaders)) {
        expect(headers[name], name).toBe(value);
      }
    });
  }

  test("a 404 page carries them as well", async ({ request }) => {
    const response = await request.get("/does-not-exist");

    expect(response.status()).toBe(404);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test.describe("pages", () => {
    test.skip(!productionBuild, "needs the production build");

    test("have a CSP with a nonce that changes on every request", async ({
      page,
      request,
    }) => {
      const first = await request.get("/");
      const second = await request.get("/");
      const nonceOf = (csp: string | undefined) =>
        /'nonce-([^']+)'/.exec(csp ?? "")?.[1];

      const firstNonce = nonceOf(first.headers()["content-security-policy"]);
      const secondNonce = nonceOf(second.headers()["content-security-policy"]);

      expect(firstNonce).toBeTruthy();
      expect(secondNonce).toBeTruthy();
      expect(firstNonce).not.toBe(secondNonce);

      const csp = first.headers()["content-security-policy"] ?? "";
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("unsafe-eval");
      // Every script in the HTML carries this response's nonce.
      // The HTML is read with a real parser (not a regular expression), in an inert
      // document, where the browser does not hide the nonce attribute.
      const html = await first.text();
      await page.goto("about:blank");
      const nonces = await page.evaluate(
        (source) =>
          Array.from(
            new DOMParser()
              .parseFromString(source, "text/html")
              .querySelectorAll("script"),
          ).map((script) => script.getAttribute("nonce")),
        html,
      );
      expect(nonces.length).toBeGreaterThan(0);
      expect(nonces.every((nonce) => nonce === firstNonce)).toBe(true);
    });

    test("the home page keeps the strict CSP and ships no Clerk origin", async ({
      request,
    }) => {
      const csp =
        (await request.get("/")).headers()["content-security-policy"] ?? "";

      expect(csp).toContain("style-src 'self';");
      expect(csp).not.toContain("clerk");
      expect(csp).not.toContain("cloudflare.com");
    });

    test("load, hydrate and switch language without a single CSP violation", async ({
      page,
    }) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text())) {
          violations.push(message.text());
        }
      });

      await page.goto("/");
      await page.getByRole("button", { name: "English" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await page.goto("/does-not-exist");

      expect(violations).toEqual([]);
    });
  });
});

test.describe("robots.txt", () => {
  test("blocks the admin area, the API and AI crawlers", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");
    const body = await response.text();

    expect(response.status()).toBe(200);
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /api/");
    for (const bot of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]) {
      expect(body, bot).toContain(`User-agent: ${bot}`);
    }
    // Search engines are not blocked.
    expect(body).not.toMatch(/User-agent: Googlebot/);
  });
});

test.describe("rate limiting", () => {
  test("a burst against a write endpoint is throttled", async ({
    request,
    baseURL,
  }) => {
    // Cloudflare sets this header at the edge; a unique value here keeps this
    // test from using up the budget of the other tests.
    const caller = `burst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const statuses: number[] = [];

    for (let i = 0; i < 45; i += 1) {
      const response = await request.post("/api/locale", {
        form: { locale: "es", redirectTo: "/" },
        headers: { Origin: baseURL ?? "", "CF-Connecting-IP": caller },
        maxRedirects: 0,
      });
      statuses.push(response.status());
    }

    expect(statuses[0]).toBe(303);
    expect(statuses).toContain(429);
  });
});
