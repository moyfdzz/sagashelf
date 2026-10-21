# ADR-003: Clerk for accounts, with a local `users` mirror

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Planned (SAG-10, SAG-11, SAG-12)
- **Tickets:** SAG-10, SAG-11, SAG-12, SAG-29

## Context

Accounts with emails and passwords are the largest security risk in the product: credential stuffing, weak passwords, account takeover, and the same person creating many accounts. A personal project should not store passwords, send verification emails, or run brute-force protection by itself.

## Decision

- **Clerk stores and verifies credentials.** SagaShelf never stores a password. Sign-in is email and password plus Google. Email verification is required, usernames are required (3 to 30 characters, restricted characters, reserved words blocked), the breached-password check and brute-force lockout are on, multi-factor authentication is optional and **required for admins**, and sign-up has bot protection and a block on disposable email domains.
- **Roles live in Clerk `publicMetadata`.** Authorization is checked on the server with `requireUser` and `requireRole('admin')`. A user id sent by the browser is never trusted.
- **A local `users` mirror** in Postgres is kept in sync by a Clerk webhook (SAG-11): Svix signature verification, an idempotency table (`processed_webhooks`, unique provider and event id), and handling of out-of-order events.
- **Email normalization is ours.** `email_canonical` (trim, Unicode NFKC, lowercase, IDN to punycode, and for providers that ignore dots and `+tags` also strip those) is stored as UNIQUE so one inbox cannot register many accounts. The original address is kept for sending.
- **Privacy in logs.** No password, token or full email address is written to logs. Error messages are generic so they do not reveal whether an account exists.
- **Localized and constrained.** Auth pages are available in Spanish and English (ADR-008), and the content security policy allows Clerk origins only (SAG-7).

## Alternatives considered

- **Own authentication with stored password hashes.** Maximum control, but this project would own credential storage, reset flows, email delivery and abuse protection. Rejected as the biggest avoidable risk.
- **Authentication libraries that run inside the app.** They still leave credential storage and abuse handling to the project. Rejected for the same reason.
- **Identity-aware access products aimed at staff (for example Cloudflare Access).** Suited to protecting internal tools, not to public sign-up. They may still protect preview URLs (see ADR-010).

## Consequences

**Good**

- No credentials in our database, and a mature implementation of verification, MFA and lockout.
- The mirror lets queries join users without calling Clerk on every request.

**Costs and risks**

- A third-party dependency for sign-in: an outage or a policy change affects the product, and moving away later means a migration.
- Two sources of truth for a user (Clerk and the mirror) must stay consistent, which is why webhook ordering and idempotency are part of the design.
- The free plan limits of Clerk were **not verified** here. Check them when the Clerk application is created.

## Open questions

- Exact Clerk plan limits and which of the listed protections (for example the breached-password check) are included in the free plan. Confirm in SAG-10.

## References

- Tickets SAG-10, SAG-11 and SAG-12 (Linear)
