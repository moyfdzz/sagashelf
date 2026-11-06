import { http, HttpResponse } from "msw";

/**
 * Sightengine handlers for the tests, shaped like the example answer of the model `nudity-2.1`
 * (read 2026-11-05), with the fields the client reads. Sightengine was not called to write this:
 * the first real answer is seen in production.
 */
export const sightengineEndpoint = "https://api.sightengine.com/1.0/check.json";

export function safeScores() {
  return {
    sexual_activity: 0.01,
    sexual_display: 0.01,
    erotica: 0.01,
    very_suggestive: 0.01,
    suggestive: 0.01,
    mildly_suggestive: 0.01,
    none: 0.99,
  };
}

export type SeenCheck = { url: URL; form: FormData };

export function sightengineAnswers(
  scores: Record<string, number>,
  seen: SeenCheck[] = [],
) {
  return http.post(sightengineEndpoint, async ({ request }) => {
    seen.push({ url: new URL(request.url), form: await request.formData() });
    return HttpResponse.json({
      status: "success",
      request: { id: "req_fake", timestamp: 1, operations: 1 },
      nudity: { ...safeScores(), ...scores },
      media: { id: "med_fake", uri: "picture" },
    });
  });
}
