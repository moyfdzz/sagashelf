import { z } from "zod";

import type { PictureType } from "../account/picture-file";

export type ModerationKeys = { apiUser: string; apiSecret: string };

export type ModerationAnswer = "allowed" | "rejected" | "unavailable";

const endpoint = "https://api.sightengine.com/1.0/check.json";

const timeoutMs = 8000;

/**
 * From this score up, a level of the model refuses the picture (ADR-037). Sightengine recommends no
 * number, and this one was not measured with real pictures. The levels below `very_suggestive`,
 * such as a swimsuit at the beach, are allowed.
 */
export const refuseFromScore = 0.5;

const answerSchema = z.object({
  status: z.literal("success"),
  nudity: z.object({
    sexual_activity: z.number(),
    sexual_display: z.number(),
    erotica: z.number(),
    very_suggestive: z.number(),
  }),
});

/**
 * Asks Sightengine whether a picture may be published. Any answer that is not a clear yes or no,
 * such as a timeout or the limit of the plan, is `unavailable`, and the caller saves nothing.
 * The keys go in the body of the request, never in an address, and no log here carries them: only
 * the name of the error is written.
 */
export async function moderatePicture(
  bytes: Uint8Array<ArrayBuffer>,
  type: PictureType,
  keys: ModerationKeys,
): Promise<ModerationAnswer> {
  const form = new FormData();
  form.set("media", new File([bytes], "picture", { type }));
  form.set("models", "nudity-2.1");
  form.set("api_user", keys.apiUser);
  form.set("api_secret", keys.apiSecret);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = answerSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success) {
      console.error("picture moderation: no answer", response.status);
      return "unavailable";
    }
    const { nudity } = parsed.data;
    return Math.max(
      nudity.sexual_activity,
      nudity.sexual_display,
      nudity.erotica,
      nudity.very_suggestive,
    ) >= refuseFromScore
      ? "rejected"
      : "allowed";
  } catch (error) {
    console.error("picture moderation: failed", (error as Error).name);
    return "unavailable";
  }
}
