import { z } from "zod";

const siteverifyUrl =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const siteverifyResponse = z.object({ success: z.boolean() });

/**
 * Checks a Turnstile token on the server. The widget alone protects nothing: a form
 * is only protected once its handler calls this. A token works once and expires in
 * five minutes, so a failed or repeated check returns false. Any error returns false too.
 */
export async function verifyTurnstile(options: {
  secret: string;
  token: string;
  remoteIp?: string;
}): Promise<boolean> {
  const body = new URLSearchParams({
    secret: options.secret,
    response: options.token,
  });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);

  try {
    const response = await fetch(siteverifyUrl, { method: "POST", body });
    if (!response.ok) return false;
    const parsed = siteverifyResponse.safeParse(await response.json());
    return parsed.success && parsed.data.success;
  } catch {
    return false;
  }
}
