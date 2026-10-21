import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "./testing/msw";
import { verifyTurnstile } from "./turnstile";

const siteverify = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

describe("verifyTurnstile", () => {
  it("accepts a token that Cloudflare confirms and sends the secret and token", async () => {
    let received: URLSearchParams | undefined;
    mswServer.use(
      http.post(siteverify, async ({ request }) => {
        received = new URLSearchParams(await request.text());
        return HttpResponse.json({ success: true });
      }),
    );

    const ok = await verifyTurnstile({
      secret: "secret-value",
      token: "token-value",
      remoteIp: "1.2.3.4",
    });

    expect(ok).toBe(true);
    expect(received?.get("secret")).toBe("secret-value");
    expect(received?.get("response")).toBe("token-value");
    expect(received?.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits the IP when it is not known", async () => {
    let received: URLSearchParams | undefined;
    mswServer.use(
      http.post(siteverify, async ({ request }) => {
        received = new URLSearchParams(await request.text());
        return HttpResponse.json({ success: true });
      }),
    );

    await verifyTurnstile({ secret: "s", token: "t" });

    expect(received?.has("remoteip")).toBe(false);
  });

  it("rejects a token that Cloudflare refuses (expired, repeated or invalid)", async () => {
    mswServer.use(
      http.post(siteverify, () =>
        HttpResponse.json({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      ),
    );

    expect(await verifyTurnstile({ secret: "s", token: "t" })).toBe(false);
  });

  it("rejects when Cloudflare answers with an error status", async () => {
    mswServer.use(
      http.post(siteverify, () => new HttpResponse(null, { status: 500 })),
    );

    expect(await verifyTurnstile({ secret: "s", token: "t" })).toBe(false);
  });

  it("rejects a reply it cannot understand", async () => {
    mswServer.use(http.post(siteverify, () => HttpResponse.json({ ok: 1 })));

    expect(await verifyTurnstile({ secret: "s", token: "t" })).toBe(false);
  });

  it("rejects when the request itself fails", async () => {
    mswServer.use(http.post(siteverify, () => HttpResponse.error()));

    expect(await verifyTurnstile({ secret: "s", token: "t" })).toBe(false);
  });
});
