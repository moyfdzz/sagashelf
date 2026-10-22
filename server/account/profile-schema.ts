import { z } from "zod";

import { reservedUsernames } from "../auth/clerk-user";

// The limits match the `users` table (bio <= 500 characters, username 3 to 30, two languages).
export const displayNameMaxLength = 50;
export const bioMaxLength = 500;
export const usernameMinLength = 3;
export const usernameMaxLength = 30;

/** Right-to-left and left-to-right overrides and isolates: they can make text read backwards. */
function isBidiControl(code: number): boolean {
  return (
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Removes characters that are not text: control codes (a tab and a line break are kept when
 * `keepNewlines` is true), the bidirectional overrides and the zero width characters that make
 * two different names look the same. Everything else, accents and emoji included, stays.
 */
export function cleanText(value: string, keepNewlines: boolean): string {
  let result = "";
  for (const char of value.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    const isNewline = code === 0x0a || code === 0x0d || code === 0x09;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      if (keepNewlines && isNewline) result += char;
      else if (isNewline) result += " ";
      continue;
    }
    if (isBidiControl(code)) continue;
    if (code >= 0x200b && code <= 0x200d) continue;
    if (code === 0xfeff || code === 0x2060) continue;
    result += char;
  }
  return result;
}

const length = (text: string) => [...text].length;

/** A name to show: one line, spaces collapsed, no control characters. Empty means "none". */
const displayName = z
  .string()
  .transform((value) => cleanText(value, false).replace(/\s+/g, " ").trim())
  .refine((value) => length(value) <= displayNameMaxLength, {
    message: "display_name_too_long",
  })
  .transform((value) => (value === "" ? null : value));

/**
 * A short text about the person. It is stored as plain text and the pages escape it when they
 * draw it, so tags are not removed here, only control characters. Line breaks are kept, and
 * three or more in a row become two. Empty means "none".
 */
const bio = z
  .string()
  .transform((value) =>
    cleanText(value.replace(/\r\n?/g, "\n"), true)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  )
  .refine((value) => length(value) <= bioMaxLength, { message: "bio_too_long" })
  .transform((value) => (value === "" ? null : value));

export const localeSchema = z.enum(["es", "en"]);
export const privacySchema = z.enum(["public", "friends", "private"]);

/**
 * The username a person asks for. Clerk is the source of truth and enforces its own rules; this
 * check runs first so that a reserved or malformed name is refused before any request to Clerk.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(usernameMinLength, { message: "username_too_short" })
  .max(usernameMaxLength, { message: "username_too_long" })
  .regex(/^\S+$/u, { message: "username_has_spaces" })
  .refine((value) => !reservedUsernames.has(value.toLowerCase()), {
    message: "username_reserved",
  });

/**
 * What the profile form may change. `strict` makes any other key an error, so a request that
 * carries `role`, `clerkId`, `deletedAt` or an email is refused instead of ignored. Every field
 * is optional, so a form can send only what it edits.
 */
export const profileUpdateSchema = z
  .object({
    displayName: displayName.optional(),
    bio: bio.optional(),
    locale: localeSchema.optional(),
    privacy: privacySchema.optional(),
  })
  .strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
