import { http, HttpResponse } from "msw";

/**
 * Discord webhook fixtures for the tests. The address is made up and has the shape of a real one
 * (`/api/webhooks/<id>/<token>`, checked against Discord's page on 2026-11-02, which gives the path
 * `POST /webhooks/{webhook.id}/{webhook.token}`); the id and the token are not those of any webhook.
 *
 * The answers follow what that page and the rate limits page say: success without `wait` is
 * `204 No Content`; a 429 has a JSON body with `message`, `retry_after` (seconds, a float) and
 * `global`, and a `Retry-After` header.
 *
 * The token is obviously made up and repeats itself on purpose: a made-up token with a high entropy
 * is flagged by the secret scanner as if it were real (it was, in the first run of SAG-27).
 */
export const fakeWebhookId = "123456789012345678";
export const fakeWebhookToken =
  "fake_webhook_token_fake_webhook_token_fake_webhook_token";
export const fakeWebhookUrl = `https://discord.com/api/webhooks/${fakeWebhookId}/${fakeWebhookToken}`;

/** A second address, so a test can have two endpoints that must not affect each other. */
export const otherWebhookUrl = `https://discord.com/api/webhooks/987654321098765432/${fakeWebhookToken.split("").reverse().join("")}`;

export const noContent = () => new HttpResponse(null, { status: 204 });

export const rateLimited = (retryAfterSeconds: number) =>
  HttpResponse.json(
    {
      message: "You are being rate limited.",
      retry_after: retryAfterSeconds,
      global: false,
    },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterSeconds)) },
    },
  );

/** A handler for one webhook address that answers with `respond` and records what it was sent. */
export function discordHandler(
  url: string,
  respond: () => Response | Promise<Response>,
  received: { body: unknown; headers: Headers }[] = [],
) {
  return http.post(url, async ({ request }) => {
    received.push({ body: await request.json(), headers: request.headers });
    return respond();
  });
}
