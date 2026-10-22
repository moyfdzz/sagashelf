# ADR-003: Clerk for accounts, with a local `users` mirror

- **Status:** Accepted
- **Date:** 2026-10-20 (refined 2026-10-21 in SAG-10, see "Changes made in SAG-10")
- **Implementation:** Partial (sessions, guards and the sign-in and sign-up pages are built in SAG-10, the webhook in SAG-11; account settings and the full erasure are SAG-12)
- **Tickets:** SAG-10, SAG-11, SAG-12, SAG-29

## Context

Accounts with emails and passwords are the largest security risk in the product: credential stuffing, weak passwords, account takeover, and the same person creating many accounts. A personal project should not store passwords, send verification emails, or run brute-force protection by itself.

## Decision

- **Clerk stores and verifies credentials.** SagaShelf never stores a password. Sign-in is email or username with a password, a one-time email code, and Google. Email verification is required at sign-up, usernames are required (3 to 30 characters, no extended characters, no all-numeric names), and the breached-password check is on. Sign-up has Clerk's bot challenge ("Challenge suspicious sign-ups") and blocks both disposable email domains and email subaddresses.
- **The administrator signs in with Google and its 2-step verification.** The free Clerk plan has no multi-factor authentication and no passkeys (see "Verified facts"), so the administrator's account has no password and relies on the 2-step verification of the Google account. `requireRole('admin')` also checks that the Clerk account has a **verified Google login**, so an email code alone is never enough for the admin area.
- **Roles live in our `users.role` column, not in Clerk.** The first version of this ADR said Clerk `publicMetadata`. A role in our own table is changed with SQL, is read in the same query that loads the user, and needs no call to Clerk. The first administrator is set by hand in the database. Authorization is checked on the server with `requireUser` and `requireRole('admin')` (`server/auth/`). A user id sent by the browser is never trusted: the id comes from the verified session.
- **Sessions are verified in the Worker without a network call.** `clerkMiddleware` runs in the root route with the instance's JWT public key (`CLERK_JWT_KEY`), so a valid session token costs no request to Clerk. When the token has expired, Clerk's handshake refreshes it. Without Clerk keys (tests, previews) public pages still work and protected routes answer 503, never "allowed".
- **Clerk's code runs only on the sign-in and sign-up pages.** Those two routes embed Clerk's components and get a wider content security policy; every other page reads the session on the server, ships no Clerk code, and keeps the strict policy (ADR-011). See "Content security policy per route".
- **A local `users` mirror** in Postgres is kept in sync by a Clerk webhook, `POST /webhooks/clerk` (SAG-11). A session without a mirror row is refused with 403 until the webhook has created it. See "The webhook" below for how it works.
- **Email normalization is ours.** `email_canonical` (trim, Unicode NFKC, lowercase, IDN to punycode, and for providers that ignore dots and `+tags` also strip those) is stored as UNIQUE so one inbox cannot register many accounts. Clerk's own subaddress block is a second layer. The original address is kept for sending.
- **Reserved usernames are checked on our side.** Clerk's free plan cannot block names such as `admin`, `api` or `settings`, so the webhook refuses to mirror an account that has one (`reservedUsernames` in `server/auth/clerk-user.ts`, compared in lower case like the `citext` column).
- **Privacy in logs.** No password, token or full email address is written to logs. Error messages are generic so they do not reveal whether an account exists.
- **Localized.** The auth pages are available in Spanish and English (ADR-008) through `@clerk/localizations`. The Spanish pack (`es-MX`) leaves some texts empty, so `app/lib/clerk-localization.ts` fills the ones a visitor can reach.
- **Two Clerk instances.** A development instance (`pk_test_`, `sk_test_`) is used locally and on previews. A production instance is created when the site goes live, with its DNS records in Cloudflare (DNS only, not proxied) and our own Google OAuth credentials (see [`edge-setup.md`](../edge-setup.md)).

## Content security policy per route

Clerk's embedded components need origins and a style allowance that the strict policy forbids. Instead of loosening the whole site, `/sign-in` and `/sign-up` get a separate policy built in `server/security-headers.ts` and chosen in `app/entry.server.tsx`. Per the [Clerk CSP guide](https://clerk.com/docs/guides/secure/best-practices/csp-headers) (read 2026-10-21) it adds only:

- `script-src`: the instance's Frontend API host (decoded from the publishable key), `challenges.cloudflare.com` and `*.protect.clerk.com`, next to `'self'` and the page's nonce.
- `connect-src`: the Frontend API host and `*.protect.clerk.com` on any port.
- `frame-src`: `challenges.cloudflare.com` and `*.protect.clerk.com`.
- `img-src`: `img.clerk.com`. `worker-src`: `'self'` and `blob:`.
- `style-src 'unsafe-inline'`, because Clerk styles itself at runtime. Scripts never get `'unsafe-inline'` or `'unsafe-eval'`.

Unit tests pin the exact lists, and an e2e test checks that the home page keeps the strict policy and mentions no Clerk origin. In the production build, the sign-in page was loaded in a real browser with no policy violations.

## The webhook

`POST /webhooks/clerk` (`app/routes/webhooks.clerk.ts`) is the first incoming webhook. In order:

1. **Limits first.** A body over 64 kB gets 413 and a caller over the write limit gets 429, before anything is read or checked. A missing signing secret answers 503, never "allowed".
2. **Signature before parsing.** `verifyWebhook` from `@clerk/backend/webhooks` checks the `svix-id`, `svix-timestamp` and `svix-signature` headers against the endpoint's signing secret (`CLERK_WEBHOOK_SIGNING_SECRET`, a Workers secret) over the raw body. It rejects a timestamp more than 5 minutes old or in the future (read in `standardwebhooks` 1.1.1 on 2026-10-22). Any failure answers 401 with the same short body, and the database is never opened.
3. **One statement per event** (`server/db/clerk-sync.ts`). The Neon HTTP driver cannot read in the middle of a transaction, so a single SQL statement does everything: it inserts the verified `svix-id` into `processed_webhooks` (primary key on provider and event id) and applies the change only if that insert was new. A statement is atomic, so the mark and the change land together or not at all. A repeated event writes nothing and answers 200.
4. **Ordering.** `users.clerk_updated_at` holds the time Clerk gave to the last applied event (the user's own `updated_at`, or the event time for a deletion). A change is applied only when it is newer, so an older event that arrives late is recorded and changes nothing. A deletion wins a tie with an update of the same millisecond.
5. **What is mirrored.** `user.created` and `user.updated` do the same upsert by `clerk_id`: username, display name, an https avatar and the canonical email of the **verified primary** email. The language comes from Clerk only when the row is created. The role, privacy, bio and `deleted_at` are never in the update, so this endpoint cannot make anyone an administrator.
6. **Deletion.** `user.deleted` sets `deleted_at` and clears the display name, avatar and bio. The row stays so the username, the Clerk id and the canonical email stay reserved. A deleted account is not brought back by a later update. The rest of the erasure and the export are SAG-12.
7. **Refused accounts.** An account with a reserved or malformed username, no verified primary email, or a username or canonical email that another account already holds, gets no mirror row. The event is recorded and a `clerk.user_rejected` row goes to the outbox with only the Clerk id and the reason, never an email or a username, so a later job can decide what to do. Nothing is deleted in Clerk here.
8. **Failure.** A database error answers 500 so Svix retries, and logs only the event id, its type and the error name.

Tests: unit tests for the planning rules and the route (valid, forged, missing, tampered, replayed, oversized, rate limited, no secret, database failure), and integration tests on a real Postgres for replay, ordering, deletion and refusals. Breaking the ordering guard or the idempotency mark on purpose makes them fail.

## Verified facts

Read on 2026-10-21 from Clerk's pricing and documentation:

- **Free (Hobby) plan:** 50,000 retained users and a fixed 7-day session. It includes breached-password rejection, disposable-email blocking, subaddress blocking and bot protection at sign-up.
- **Not in the free plan:** multi-factor authentication, passkeys, and allow and block lists.
- **Webhooks** are delivered by Svix, at least once and in no guaranteed order, so SAG-11 must be idempotent and order-safe.
- **Measured locally in SAG-10:** the SDK runs in `workerd` and verifies valid, missing, expired and forged tokens without a network call, with about 1 ms of overhead. The Worker grew from about 216 to about 291 kB gzip for the SDK alone, and the server bundle reached about 481 kB gzip once the sign-in components were included, still far below the Free plan limit.

## Alternatives considered

- **Own authentication with stored password hashes.** Maximum control, no per-user limit, a lighter Worker, and no exception to the strict policy. But the project would own credential storage, reset and email flows, sessions, OAuth, abuse protection and the legal duties around them: weeks of work plus permanent maintenance on something that is not the product, where a flaw does the most damage. Rejected, and revisited in "Reasons to reconsider".
- **Authentication libraries that run inside the app.** They still leave credential storage and abuse handling to the project. Rejected for the same reason.
- **Identity-aware access products aimed at staff (for example Cloudflare Access).** Suited to protecting internal tools, not to public sign-up. They may still protect preview URLs (see ADR-010).
- **Only `@clerk/backend` without the React Router SDK.** Measured in SAG-10: it saves almost no weight, because the same verification code is needed, and it loses the handshake and the components.

## Consequences

**Good**

- No credentials in our database, and a mature implementation of verification, lockout, breached-password checks and bot protection.
- The mirror lets queries join users without calling Clerk on every request, and a valid session needs no call to Clerk.
- The Clerk-specific code is small and isolated (`server/auth/`, `app/middleware/clerk.ts`, two routes), and the profile and role live in our table, so leaving Clerk later is a bounded migration.

**Costs and risks**

- A third-party dependency for sign-in: an outage or a policy change affects the product, and moving away later means a migration.
- Two sources of truth for a user (Clerk and the mirror) must stay consistent, which is why webhook ordering and idempotency are part of the design.
- No multi-factor authentication or passkeys for regular users on the free plan.
- The sign-in and sign-up pages carry a wider policy than the rest of the site.
- Until the webhook endpoint is created in Clerk and receives the first `user.created`, nobody has a mirror row, so the guards refuse everyone.

## Reasons to reconsider

Revisit this decision if Clerk removes or changes the free plan, if the project passes the 50,000-user limit with a real cost, or if multi-factor authentication for all users becomes a requirement that the free plan does not meet. Moving to the paid plan is the first option, before writing our own.

## Open questions

- CPU time in a real Cloudflare Worker (the Free plan allows 10 ms per request) was **not measured**: only local numbers exist. Measure it on a preview and record the result in SAG-10.
- The production instance (DNS records, Google OAuth credentials and the production keys) is not created yet.
- Whether Clerk offers a way to disable the email-code sign-in for one account only. It stays enabled for everyone, and the admin guard requires a verified Google login instead.
- The admin guard asks Clerk for the user's Google login with one API call, and that call was not tested against a real account yet.
- Whether **Bot Fight Mode** on the Free plan challenges Svix's requests to `/webhooks/clerk`. It cannot be skipped by a WAF rule on that plan. Check the delivery log in Clerk after the endpoint is created, and decide then (see `docs/edge-setup.md`).
- A `user.created` that arrives after the `user.deleted` of the same account would create the row again, because there is nothing to compare with when no row exists. Clerk does not send a created event after a deletion in practice, and a tombstone row is not worth its cost here; revisit it if it ever happens.
- A refused account stays in Clerk, signed in but with no mirror row (so every guard answers 403), until the job that reads `clerk.user_rejected` exists (SAG-27).
- The 30 requests per minute per caller of the write limit could slow down a bulk import of users; Svix retries, so nothing is lost. A separate limit is possible if it matters.

## References

- Tickets SAG-10, SAG-11 and SAG-12 (Linear)
- [Clerk CSP headers guide](https://clerk.com/docs/guides/secure/best-practices/csp-headers) and [bot protection](https://clerk.com/docs/security/bot-protection), read 2026-10-21
- ADR-008 (i18n) and ADR-011 (edge security and the strict policy)

## Changes made in SAG-10

- Roles moved from Clerk `publicMetadata` to `users.role`.
- "Multi-factor authentication required for admins" became "Google with 2-step verification, plus a verified-Google check in the guard", because the free plan has no multi-factor authentication.
- Added the per-route policy, session verification with the JWT public key, the two Clerk instances and the reserved-name check.
- Recorded the Clerk free plan limits as verified instead of open.

## Changes made in SAG-11

- Added "The webhook" section, replacing the one-line plan. Ordering uses a new column, `users.clerk_updated_at`, not `updated_at` (which is when the row changed here).
- Idempotency is one SQL statement per event instead of "in the same transaction", because the Neon HTTP driver cannot read between statements.
- Refused accounts are recorded and queued instead of failing the webhook, so Svix does not retry them forever.
