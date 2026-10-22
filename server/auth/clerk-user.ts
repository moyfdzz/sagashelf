import { canonicalEmail } from "./canonical-email";

/**
 * Names a person may not take because they would look like the site, or collide with a path
 * (SAG-11). Clerk's free plan cannot block them at sign-up, so the webhook refuses to mirror an
 * account that has one. Compared in lower case, like the `citext` column.
 */
export const reservedUsernames: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "administrator",
  "api",
  "assets",
  "help",
  "library",
  "lists",
  "login",
  "logout",
  "me",
  "mod",
  "moderator",
  "null",
  "profile",
  "register",
  "root",
  "saga",
  "sagas",
  "sagashelf",
  "search",
  "settings",
  "sign-in",
  "sign-out",
  "sign-up",
  "signin",
  "signup",
  "static",
  "support",
  "system",
  "undefined",
  "user",
  "users",
  "webhooks",
  "www",
]);

export type RejectReason =
  | "reserved_username"
  | "invalid_username"
  | "no_verified_email"
  | "invalid_email";

/** The part of a Clerk user that the local `users` row mirrors. Never the role. */
export type MirrorUser = {
  clerkId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailCanonical: string;
  locale: "es" | "en";
  /** The time Clerk gave to this version of the user. */
  at: Date;
};

export type ClerkOperation =
  | { kind: "upsert"; user: MirrorUser }
  | { kind: "delete"; clerkId: string; at: Date }
  | { kind: "reject"; clerkId: string; reason: RejectReason }
  | { kind: "ignore" };

// The fields of a Clerk webhook that are read here. Anything else is ignored on purpose.
type ClerkUserData = {
  id?: unknown;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  image_url?: unknown;
  locale?: unknown;
  primary_email_address_id?: unknown;
  email_addresses?: unknown;
  updated_at?: unknown;
};

export type ClerkEventLike = {
  type: string;
  timestamp?: unknown;
  data: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Clerk's own example event gives the event time in seconds and the user's times in
// milliseconds. Below this a number can only be seconds (it is January 1973 in milliseconds,
// and the year 5138 in seconds), so both are read correctly instead of one becoming 1970.
const secondsBelow = 100_000_000_000;

function asDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value < secondsBelow ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function httpsUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

/** The primary email address, and only when Clerk says it is verified. */
function verifiedPrimaryEmail(data: ClerkUserData): string | null {
  if (!Array.isArray(data.email_addresses)) return null;
  const primaryId = asString(data.primary_email_address_id);
  if (!primaryId) return null;

  for (const entry of data.email_addresses as unknown[]) {
    const email = entry as {
      id?: unknown;
      email_address?: unknown;
      verification?: { status?: unknown } | null;
    };
    if (email.id !== primaryId) continue;
    return email.verification?.status === "verified"
      ? asString(email.email_address)
      : null;
  }
  return null;
}

function displayNameOf(data: ClerkUserData): string | null {
  const parts = [asString(data.first_name), asString(data.last_name)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" ").slice(0, 100) : null;
}

/**
 * Turns a verified Clerk event into the one change to make locally. Pure: it reads nothing and
 * writes nothing, so every rule here has a unit test. An account without a verified primary
 * email, with a reserved username, or with a malformed one is refused (`reject`) instead of
 * mirrored, so the guards never let it in.
 */
export function planClerkEvent(event: ClerkEventLike): ClerkOperation {
  if (event.type === "user.deleted") {
    const { id } = (event.data ?? {}) as { id?: unknown };
    const clerkId = asString(id);
    const at = asDate(event.timestamp);
    return clerkId && at ? { kind: "delete", clerkId, at } : { kind: "ignore" };
  }
  if (event.type !== "user.created" && event.type !== "user.updated") {
    return { kind: "ignore" };
  }

  const data = (event.data ?? {}) as ClerkUserData;
  const clerkId = asString(data.id);
  // The user's own update time when there is one, else the time of the event.
  const at = asDate(data.updated_at) ?? asDate(event.timestamp);
  if (!clerkId || !at) return { kind: "ignore" };

  const username = asString(data.username);
  if (!username || !/^\S{3,30}$/u.test(username)) {
    return { kind: "reject", clerkId, reason: "invalid_username" };
  }
  if (reservedUsernames.has(username.toLowerCase())) {
    return { kind: "reject", clerkId, reason: "reserved_username" };
  }

  const address = verifiedPrimaryEmail(data);
  if (!address) return { kind: "reject", clerkId, reason: "no_verified_email" };
  const emailCanonical = canonicalEmail(address);
  if (!emailCanonical) {
    return { kind: "reject", clerkId, reason: "invalid_email" };
  }

  return {
    kind: "upsert",
    user: {
      clerkId,
      username,
      displayName: displayNameOf(data),
      avatarUrl: httpsUrl(data.image_url),
      emailCanonical,
      locale: asString(data.locale)?.toLowerCase().startsWith("en")
        ? "en"
        : "es",
      at,
    },
  };
}
