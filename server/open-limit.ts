import { rateLimit } from "./rate-limit";
import { getOpenLimiter } from "./runtime-env";

/**
 * Spends one unit of the per-person budget of new titles (ADR-035). Every route that saves a
 * title from a provider calls this, so the key is written once. Returns a 429 response when the
 * person is over the limit, or null when the call to the provider may go on.
 */
export const spendOpenUnit = (request: Request, userId: string) =>
  rateLimit(getOpenLimiter(), request, `media-open:${userId}`);
