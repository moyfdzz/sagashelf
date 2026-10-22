export type Role = "user" | "moderator" | "admin";

export type SessionUser = { id: string; clerkId: string; role: Role };

export type Denial = "signed_out" | "no_account" | "forbidden";

export type AuthResult =
  { ok: true; user: SessionUser } | { ok: false; reason: Denial };

export type AuthDeps = {
  /** Our own row for a Clerk id; null when there is none or the account was deleted. */
  findUser(clerkId: string): Promise<SessionUser | null>;
  /** True when the Clerk account has a verified Google login. Only asked for admins. */
  hasVerifiedGoogle(clerkId: string): Promise<boolean>;
};

/**
 * Decides who the caller is. `clerkId` comes from the verified session, never from the
 * request body or the URL. The role comes from our `users` table, not from Clerk. Clerk only
 * issues a session once the email is verified (sign-up requires the code), so a session
 * means a verified email; the local row exists only for accounts the webhook mirrored.
 */
export async function authorize(
  clerkId: string | null,
  deps: AuthDeps,
  role?: Role,
): Promise<AuthResult> {
  if (!clerkId) return { ok: false, reason: "signed_out" };

  const user = await deps.findUser(clerkId);
  if (!user) return { ok: false, reason: "no_account" };

  if (role === "admin") {
    // The administrator signs in with Google, which carries the 2-step verification.
    if (user.role !== "admin" || !(await deps.hasVerifiedGoogle(clerkId))) {
      return { ok: false, reason: "forbidden" };
    }
  } else if (role && user.role !== role) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, user };
}
