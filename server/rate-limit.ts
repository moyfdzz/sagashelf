/** The shape of a Workers Rate Limiting binding. */
export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

/**
 * Counts one request against `limiter`. Returns a 429 response when the caller is over
 * the limit, or null when the request may go on. The count is per Cloudflare location
 * and eventually consistent, so it slows abuse down; it is not an exact quota.
 */
export async function rateLimit(
  limiter: RateLimiter,
  request: Request,
  scope: string,
): Promise<Response | null> {
  // Cloudflare sets this header at the edge. Once users can sign in, key by user id instead.
  const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await limiter.limit({ key: `${scope}:${caller}` });
  if (success) return null;

  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}
