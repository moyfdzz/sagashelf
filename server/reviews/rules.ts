/**
 * The rules of a review that need no database (SAG-22, ADR-053). The numbers live here once: the
 * check constraint of `reviews` repeats the length (a test reads it), and the form has a copy in
 * `app/lib/review-limits.ts` that another test compares.
 */

/** The shortest and the longest review, in characters (code points, like `char_length`). */
export const reviewMinLength = 500;
export const reviewMaxLength = 5000;

/** New reviews a person may write in one hour, counted in Postgres. An edit does not count. */
export const reviewsPerHour = 10;

/** How old an account must be before others see its reviews. */
export const newAccountHours = 24;

/** Reviews on one page of a title. */
export const reviewPageSize = 10;

/** How much of a review the feed and the title page show before "see more". */
export const reviewExcerptLength = 300;

/**
 * The text as it is stored: line breaks as `\n`, no spaces at the ends. Inner line breaks and
 * spaces stay, since a review is plain text with its paragraphs.
 */
export function normalizeReviewBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

/** The length the way Postgres counts it: one per code point, so an emoji counts once. */
export const reviewLength = (body: string) => [...body].length;

// Something that looks like an address: a scheme, `www.`, or a name followed by a common ending.
// A review needs no links (ADR-053), and most review spam is links. The ending must be all
// lowercase or all uppercase, and the endings that are common words ("es", "me", "co", "us",
// "ar") are left out, so "mucho.Es una serie" or "lo mejor.es que" written without a space after
// the period are not taken for an address.
const endings = [
  "com",
  "net",
  "org",
  "info",
  "biz",
  "io",
  "ly",
  "gg",
  "tv",
  "xyz",
  "top",
  "site",
  "online",
  "shop",
  "store",
  "app",
  "dev",
  "link",
  "club",
  "ru",
  "cn",
  "mx",
  "br",
  "uk",
];
const addressStart = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)/i;
const domain = (list: readonly string[]) =>
  new RegExp(
    `\\b[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.(?:${list.join("|")})\\b`,
  );
const lowerDomain = domain(endings);
const upperDomain = domain(endings.map((ending) => ending.toUpperCase()));
/** The text holds something that looks like a link. */
export const hasLink = (body: string) =>
  addressStart.test(body) || lowerDomain.test(body) || upperDomain.test(body);

/**
 * The text a duplicate is compared on: lowercase, without accents, with every run of spaces,
 * punctuation and symbols made one space. "Great show!!" and "great   show" are the same.
 */
export function duplicateKey(body: string): string {
  return body
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

/** The SHA-256 of `duplicateKey`, in hex: what `reviews.fingerprint` stores. */
export async function reviewFingerprint(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(duplicateKey(body));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Why the text of a review is refused before the database is asked, or null when it may go. */
export type BodyProblem = "too_short" | "too_long" | "link";

export function bodyProblem(body: string): BodyProblem | null {
  const length = reviewLength(body);
  if (length < reviewMinLength) return "too_short";
  if (length > reviewMaxLength) return "too_long";
  if (hasLink(body)) return "link";
  return null;
}

/**
 * The start of a review for the feed and the title page, cut at a space so no word is split, and
 * the rest. `rest` is empty when the whole text fits. The two together are the text.
 */
export function splitExcerpt(
  body: string,
  length = reviewExcerptLength,
): { excerpt: string; rest: string } {
  const points = [...body];
  if (points.length <= length) return { excerpt: body, rest: "" };
  const head = points.slice(0, length).join("");
  const space = head.search(/\s\S*$/u);
  const cut = space > length / 2 ? space : head.length;
  return { excerpt: body.slice(0, cut), rest: body.slice(cut) };
}
