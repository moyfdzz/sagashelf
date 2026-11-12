import { isbot } from "isbot";
import { z } from "zod";

/**
 * The events of the cookieless analytics and the pure rules around them (SAG-24, ADR-009,
 * ADR-050). Nothing here touches the database or the network, so every rule is tested alone.
 */

const mediaKinds = ["anime", "movie", "series", "book", "manga"] as const;

/** Postgres cannot store the NUL character in text: it would turn a request into a server error. */
const hasNoNul = (value: string) => !value.includes("\u0000");

/** A path of this site: no query string, no fragment, no spaces, no NUL. */
const pathSchema = z
  .string()
  .max(200)
  .regex(/^\/[^?#\s]*$/)
  .refine(hasNoNul);

const utmSchema = z.string().trim().min(1).max(100).refine(hasNoNul).optional();

const pageviewSchema = z.object({
  kind: z.literal("pageview"),
  path: pathSchema,
  // The page the visitor came from. Only its class and its host are kept, never the address.
  referrer: z.string().max(500).refine(hasNoNul).optional(),
  utmSource: utmSchema,
  utmMedium: utmSchema,
  utmCampaign: utmSchema,
});

const engagedSchema = z.object({
  kind: z.literal("engaged"),
  path: pathSchema,
  // Milliseconds with the tab visible. Four hours is more than anybody reads one page.
  ms: z.number().int().min(0).max(14_400_000),
});

const searchSchema = z.object({
  kind: z.literal("search"),
  path: pathSchema,
  // The type of the search, never its text.
  type: z.enum(["all", ...mediaKinds]),
});

const funnelSchema = z.object({
  kind: z.enum(["signup", "add_to_library", "follow"]),
  path: pathSchema,
});

export const collectEventSchema = z.discriminatedUnion("kind", [
  pageviewSchema,
  engagedSchema,
  searchSchema,
  funnelSchema,
]);

export type CollectEvent = z.infer<typeof collectEventSchema>;

/** The biggest body the collector reads. An event is a few hundred bytes. */
export const maxCollectBytes = 2048;

export type ReferrerClass =
  "direct" | "search" | "social" | "internal" | "other";

const searchEngines = [
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
  "ecosia",
  "brave",
  "yandex",
  "baidu",
  "startpage",
];

/**
 * A search engine: its name, then only a country domain or a generic one (google.com, google.com.mx,
 * google.co.uk, search.brave.com, www.bing.com). A host that merely has the name as one of its labels
 * (google.evil.example) is not one.
 */
const searchHost = new RegExp(
  `^(?:[a-z0-9-]+\\.)*(?:${searchEngines.join("|")})\\.(?:com?\\.)?[a-z]{2,3}$`,
);

const socialHosts = [
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "t.co",
  "reddit.com",
  "youtube.com",
  "tiktok.com",
  "linkedin.com",
  "pinterest.com",
  "whatsapp.com",
  "telegram.org",
  "t.me",
  "discord.com",
  "bsky.app",
  "threads.net",
  "mastodon.social",
];

function hostIs(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Where a visit came from. No referrer, or one that is not an address, is direct; the site itself is
 * internal (the visitor moved between pages); the rest is a search engine, a social network or
 * another site. Only the host of that last one is kept, never the path or the query.
 */
export function classifyReferrer(
  referrer: string | undefined,
  siteHost: string,
): { class: ReferrerClass; host: string | null } {
  if (!referrer) return { class: "direct", host: null };
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { class: "direct", host: null };
  }
  if (!host) return { class: "direct", host: null };

  const own = siteHost.toLowerCase().replace(/^www\./, "");
  if (hostIs(host, own)) return { class: "internal", host: null };
  if (searchHost.test(host)) {
    return { class: "search", host: host.slice(0, 100) };
  }
  if (socialHosts.some((domain) => hostIs(host, domain))) {
    return { class: "social", host: host.slice(0, 100) };
  }
  return { class: "other", host: host.slice(0, 100) };
}

/** A phone or a computer, from the browser's own hint when it sends one and else its name. */
export function deviceFrom(headers: Headers): "mobile" | "desktop" {
  const hint = headers.get("Sec-CH-UA-Mobile");
  if (hint) return hint === "?1" ? "mobile" : "desktop";
  return /mobi|android|iphone|ipod/i.test(headers.get("User-Agent") ?? "")
    ? "mobile"
    : "desktop";
}

/**
 * Whether a visitor asked not to be measured: Do Not Track or Global Privacy Control. Such a request
 * is answered as if it had been counted and nothing is kept (ADR-009).
 */
export function optedOut(headers: Headers): boolean {
  return headers.get("DNT") === "1" || headers.get("Sec-GPC") === "1";
}

/** Robots, crawlers and tools that open pages (Lighthouse, headless browsers) do not count. */
export function isRobot(headers: Headers): boolean {
  const agent = headers.get("User-Agent");
  // A call with no browser name is not a person at a page.
  return (
    !agent || isbot(agent) || /headless|lighthouse|playwright/i.test(agent)
  );
}

/**
 * The visitor of one day: the first 128 bits of SHA-256 over the salt of the day, the address and
 * the browser, in hex. The address is read here and goes nowhere else; the salt is new every day, so
 * the same person cannot be followed from one day to the next.
 */
export async function visitorHash(
  salt: string,
  address: string,
  agent: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}\n${address}\n${agent}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return toHex(digest.slice(0, 16));
}

/** Bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** The day of a moment in UTC, as `YYYY-MM-DD`: the day of a salt. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
