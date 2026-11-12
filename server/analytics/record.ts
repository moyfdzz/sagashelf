import { getDailySalt, insertAnalyticsEvent } from "../db/analytics";
import type { SqlExecutor } from "../db/clerk-sync";
import {
  classifyReferrer,
  deviceFrom,
  toHex,
  utcDay,
  visitorHash,
  type CollectEvent,
} from "./event";

/** The salt of the day, kept for the life of this isolate so most events cost one statement. */
let cachedSalt: { day: string; salt: string } | null = null;

/** For the tests: forget the salt kept in memory. */
export function forgetCachedSalt() {
  cachedSalt = null;
}

function randomSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function saltOf(db: SqlExecutor, day: string): Promise<string> {
  if (cachedSalt?.day === day) return cachedSalt.salt;
  // Two tries: the second one sees a salt that another call stored a moment ago.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const salt = await getDailySalt(db, day, randomSalt());
    if (salt) {
      cachedSalt = { day, salt };
      return salt;
    }
  }
  throw new Error("The salt of the day could not be read");
}

/** The country and region Cloudflare worked out for the request; never the city. */
function placeOf(request: Request): {
  country: string | null;
  region: string | null;
} {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const region =
    typeof cf?.region === "string" ? cf.region.slice(0, 100) : null;
  const country = typeof cf?.country === "string" ? cf.country : "";
  // A country is two capital letters. "XX" and "T1" are two letters too but are not countries (they
  // are not described in the Cloudflare page read for ADR-050), so they are left out.
  const isCountry =
    /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1";
  return { country: isCountry ? country : null, region };
}

/**
 * Stores one event of a visit. The address of the caller and its browser go into the visitor hash
 * and nowhere else. The fields that only some kinds have are null for the rest, as the table asks.
 */
export async function recordEvent(
  db: SqlExecutor,
  request: Request,
  event: CollectEvent,
  now: Date,
): Promise<void> {
  const salt = await saltOf(db, utcDay(now));
  const visitor = await visitorHash(
    salt,
    request.headers.get("CF-Connecting-IP") ?? "",
    request.headers.get("User-Agent") ?? "",
  );
  const { country, region } = placeOf(request);
  const referrer =
    event.kind === "pageview"
      ? classifyReferrer(event.referrer, new URL(request.url).hostname)
      : null;

  await insertAnalyticsEvent(db, {
    kind: event.kind,
    path: event.path,
    visitor,
    engagedMs: event.kind === "engaged" ? event.ms : null,
    searchType: event.kind === "search" ? event.type : null,
    lcpMs: event.kind === "vitals" ? (event.lcp ?? null) : null,
    cls: event.kind === "vitals" ? (event.cls ?? null) : null,
    inpMs: event.kind === "vitals" ? (event.inp ?? null) : null,
    referrerClass: referrer?.class ?? null,
    referrerHost: referrer?.host ?? null,
    utmSource: event.kind === "pageview" ? (event.utmSource ?? null) : null,
    utmMedium: event.kind === "pageview" ? (event.utmMedium ?? null) : null,
    utmCampaign: event.kind === "pageview" ? (event.utmCampaign ?? null) : null,
    country,
    region,
    device: deviceFrom(request.headers),
  });
}
