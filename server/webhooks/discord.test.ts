import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { sendDiscord } from "./discord";
import { discordMessage } from "./message";
import { maxRetryAfterMs } from "./outcome";
import { mswServer } from "../testing/msw";
import {
  discordHandler,
  fakeWebhookUrl,
  noContent,
  rateLimited,
} from "../testing/discord";

const message = discordMessage("webhook.test", { locale: "en" }) ?? {
  content: "",
  allowed_mentions: { parse: [] as never[] },
};

describe("sendDiscord (SAG-27)", () => {
  it("posts the message as JSON to the address, with the User-Agent of the app", async () => {
    const received: { body: unknown; headers: Headers }[] = [];
    mswServer.use(discordHandler(fakeWebhookUrl, noContent, received));

    const result = await sendDiscord(fakeWebhookUrl, message);

    expect(result).toMatchObject({ status: 204, error: null });
    expect(received).toHaveLength(1);
    expect(received[0]?.body).toEqual(message);
    expect(received[0]?.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(received[0]?.headers.get("user-agent")).toContain("SagaShelf");
  });

  it("measures how long the call took", async () => {
    mswServer.use(discordHandler(fakeWebhookUrl, noContent));
    let clock = 1_000;

    const result = await sendDiscord(fakeWebhookUrl, message, {
      now: () => (clock += 37),
    });

    expect(result.latencyMs).toBe(37);
  });

  it("reads the time to wait from the body of a 429, in seconds", async () => {
    mswServer.use(discordHandler(fakeWebhookUrl, () => rateLimited(1.5)));

    expect(await sendDiscord(fakeWebhookUrl, message)).toMatchObject({
      status: 429,
      retryAfterMs: 1500,
    });
  });

  it("reads the Retry-After header when the body of a 429 says nothing", async () => {
    mswServer.use(
      http.post(
        fakeWebhookUrl,
        () =>
          new HttpResponse("not json", {
            status: 429,
            headers: { "Retry-After": "7" },
          }),
      ),
    );

    expect(await sendDiscord(fakeWebhookUrl, message)).toMatchObject({
      status: 429,
      retryAfterMs: 7000,
    });
  });

  it("falls back to the time the limit resets in, then to nothing", async () => {
    mswServer.use(
      http.post(
        fakeWebhookUrl,
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { "X-RateLimit-Reset-After": "2.25" },
          }),
      ),
    );
    expect(await sendDiscord(fakeWebhookUrl, message)).toMatchObject({
      retryAfterMs: 2250,
    });

    mswServer.use(
      http.post(fakeWebhookUrl, () => new HttpResponse(null, { status: 429 })),
    );
    expect(
      (await sendDiscord(fakeWebhookUrl, message)).retryAfterMs,
    ).toBeNull();
  });

  it("cuts a wait that is absurdly long", async () => {
    mswServer.use(
      discordHandler(fakeWebhookUrl, () => rateLimited(10_000_000)),
    );

    expect((await sendDiscord(fakeWebhookUrl, message)).retryAfterMs).toBe(
      maxRetryAfterMs,
    );
  });

  it("ignores a retry_after that is not a number, and a negative one", async () => {
    for (const retry_after of ["soon", -5, null]) {
      mswServer.use(
        http.post(fakeWebhookUrl, () =>
          HttpResponse.json({ retry_after }, { status: 429 }),
        ),
      );

      expect(
        (await sendDiscord(fakeWebhookUrl, message)).retryAfterMs,
      ).toBeNull();
    }
  });

  it("reports what is left of the limit when Discord says it", async () => {
    mswServer.use(
      http.post(
        fakeWebhookUrl,
        () =>
          new HttpResponse(null, {
            status: 204,
            headers: {
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset-After": "1.5",
            },
          }),
      ),
    );

    expect(await sendDiscord(fakeWebhookUrl, message)).toMatchObject({
      status: 204,
      remaining: 0,
      resetAfterMs: 1500,
    });
  });

  it("gives back a 5xx as it is", async () => {
    mswServer.use(
      http.post(
        fakeWebhookUrl,
        () => new HttpResponse("boom", { status: 502 }),
      ),
    );

    expect(await sendDiscord(fakeWebhookUrl, message)).toMatchObject({
      status: 502,
      error: null,
      retryAfterMs: null,
    });
  });

  it("does not follow a redirect: it gives the 3xx back and never asks the other address", async () => {
    let asked = false;
    mswServer.use(
      http.post(
        fakeWebhookUrl,
        () =>
          new HttpResponse(null, {
            status: 307,
            headers: { Location: "https://evil.example/steal" },
          }),
      ),
      http.post("https://evil.example/steal", () => {
        asked = true;
        return noContent();
      }),
    );

    const result = await sendDiscord(fakeWebhookUrl, message);

    expect(result.status).toBe(307);
    expect(asked).toBe(false);
  });

  it("says there was no answer when the network fails", async () => {
    mswServer.use(http.post(fakeWebhookUrl, () => HttpResponse.error()));

    expect(await sendDiscord(fakeWebhookUrl, message)).toMatchObject({
      status: null,
      error: "network",
    });
  });

  it("gives up after the timeout and says so", async () => {
    mswServer.use(
      http.post(fakeWebhookUrl, async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return noContent();
      }),
    );

    expect(
      await sendDiscord(fakeWebhookUrl, message, { timeoutMs: 20 }),
    ).toMatchObject({ status: null, error: "timeout" });
  });

  it("never puts the address, the token or the body of an answer in what it returns", async () => {
    mswServer.use(
      http.post(
        fakeWebhookUrl,
        () => new HttpResponse("secret-from-the-other-side", { status: 500 }),
      ),
    );

    const result = await sendDiscord(fakeWebhookUrl, message);

    expect(JSON.stringify(result)).not.toContain("secret-from-the-other-side");
    expect(JSON.stringify(result)).not.toContain("discord.com");
    expect(JSON.stringify(result)).not.toContain(fakeWebhookUrl.slice(-10));
  });
});
