# ADR-014: No Google sign-in at launch, and no administrator until there is a second factor

- **Status:** Accepted
- **Date:** 2026-10-23
- **Implementation:** Partial (Clerk setting in the dashboard; the admin guard in the code is unchanged)
- **Tickets:** SAG-12
- **Related:** [ADR-003](003-auth-clerk.md)

## Context

ADR-003 chose Google sign-in for one reason: the administrator needs a second factor, and the free Clerk plan has none (no multi-factor authentication, no passkeys). `requireRole('admin')` therefore asks for a verified Google login. Creating the Production Clerk instance also needs our own Google OAuth credentials (a Google Cloud project, a consent screen and an OAuth client). The owner does not want to set that up for the launch, and may never add Google.

## Decision

- The Production Clerk instance has **no Google connection**. Visitors sign up and sign in with email or username and a password, with the email verification code.
- The admin guard in the code is **not changed**. With no Google login, no account can pass it, so **the admin area stays closed** in production.
- No administrator is set by hand in the database until a second factor exists for that account.

## Alternatives considered

- **Google with our own credentials:** it keeps the ADR-003 design, but costs setup work the owner does not want for the launch.
- **Change the guard to accept another factor now:** a change to security code, which needs its own ticket and tests. It is not done under SAG-12.

## Consequences

- Less to set up, and fewer third parties in the sign-in.
- There is no administrator in production. Anything that needs one waits for a decision on how to protect that account (Google later, a paid Clerk plan with multi-factor authentication, or a new guard).
- ADR-003 still describes Google for the administrator. Read it together with this record.

## Open questions

- How the administrator will be protected when one is needed. It settles whether Google comes back.

## References

- [ADR-003](003-auth-clerk.md), "The administrator signs in with Google and its 2-step verification".
