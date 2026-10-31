# ADR-003: Clerk for accounts, with a local `users` mirror

- **Status:** Accepted
- **Date:** 2026-10-20 (refined 2026-10-21 in SAG-10, see "Changes made in SAG-10")
- **Implementation:** Done (sessions, guards and the sign-in and sign-up pages in SAG-10, the webhook in SAG-11, account settings and the full erasure in SAG-12). Decided on 2026-10-31: the administrator is protected by Google with 2-step verification (the guard as it is). The first route that uses `requireRole('admin')` is the saga curation screen (SAG-92, `/admin/sagas`, ADR-026); no administrator has the role in production until the owner sets it by hand.
- **Tickets:** SAG-10, SAG-11, SAG-12, SAG-29

## Context

Accounts with emails and passwords are the largest security risk in the product: credential stuffing, weak passwords, account takeover, and the same person creating many accounts. A personal project should not store passwords, send verification emails, or run brute-force protection by itself.

## Decision

- **Clerk stores and verifies credentials.** SagaShelf never stores a password. Sign-in is email or username with a password, a one-time email code, and Google. Email verification is required at sign-up, usernames are required (3 to 30 characters, no extended characters, no all-numeric names), and the breached-password check is on. Sign-up has Clerk's bot challenge ("Challenge suspicious sign-ups") and blocks both disposable email domains and email subaddresses.
- **The administrator signs in with Google and its 2-step verification.** The free Clerk plan has no multi-factor authentication and no passkeys (see "Verified facts"), so the administrator's account has no password and relies on the 2-step verification of the Google account. `requireRole('admin')` also checks that the Clerk account has a **verified Google login**, so an email code alone is never enough for the admin area.
- **Roles live in our `users.role` column, not in Clerk.** The first version of this ADR said Clerk `publicMetadata`. A role in our own table is changed with SQL, is read in the same query that loads the user, and needs no call to Clerk. The first administrator is set by hand in the database. Authorization is checked on the server with `requireUser` and `requireRole('admin')` (`server/auth/`). A user id sent by the browser is never trusted: the id comes from the verified session.
- **Sessions are verified in the Worker without a network call.** `clerkMiddleware` runs in the root route with the instance's JWT public key (`CLERK_JWT_KEY`), so a valid session token costs no request to Clerk. When the token has expired, Clerk's handshake refreshes it. Without Clerk keys (tests, previews) public pages still work and protected routes answer 503, never "allowed".
- **Clerk's code runs only where it is needed.** The sign-in and sign-up pages embed Clerk's components and get a wider content security policy. The settings pages (`/settings/*`) load Clerk's script with no visible component, only to keep the session alive (next bullet), and get a narrow policy. Every other page reads the session on the server, ships no Clerk code, and keeps the strict policy (ADR-011). See "Content security policy per route".
- **A session token lasts 60 seconds, and only Clerk's script renews it.** On a page without that script, a normal navigation is renewed by a redirect through Clerk's server (the handshake), but a request sent in the background, such as a form saved with `fetch`, is not eligible for it. A person who left a form open for more than a minute was seen as signed out when saving (found in SAG-12). So a page where a form can stay open loads Clerk's script, which renews the token in the background. If the script cannot load, the page still works and only loses the renewal.
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

The settings pages (`isSessionPage`) get a narrower policy, built by `buildSessionContentSecurityPolicy`: the strict one plus the Frontend API host in `script-src` and `connect-src`, and `worker-src 'self' blob:`. There is nothing to draw, so no Turnstile, Clerk Protect, Clerk images, inline styles or frames are added. Unit tests pin it and check that none of those appear.

**Verified in a browser on 2026-10-22, on a preview with a real session:** Clerk's script loaded under this narrow policy, the Network tab showed repeated `tokens` and `touch` requests to the instance's Frontend API answering `200`, the console had no policy violation (only Clerk's notice about development keys), and a form left open for more than a minute was saved without sending the person to sign in. If a later Clerk version needs another origin, the console names it: add only that one, with a test.

## The webhook

`POST /webhooks/clerk` (`app/routes/webhooks.clerk.ts`) is the first incoming webhook. In order:

1. **Limits first.** A body over 64 kB gets 413 and a caller over the write limit gets 429, before anything is read or checked. A missing signing secret answers 503, never "allowed".
2. **Signature before parsing.** `verifyWebhook` from `@clerk/backend/webhooks` checks the `svix-id`, `svix-timestamp` and `svix-signature` headers against the endpoint's signing secret (`CLERK_WEBHOOK_SIGNING_SECRET`, a Workers secret) over the raw body. It rejects a timestamp more than 5 minutes old or in the future (read in `standardwebhooks` 1.1.1 on 2026-10-22). Any failure answers 401 with the same short body, and the database is never opened.
3. **One statement per event** (`server/db/clerk-sync.ts`). The Neon HTTP driver cannot read in the middle of a transaction, so a single SQL statement does everything: it inserts the verified `svix-id` into `processed_webhooks` (primary key on provider and event id) and applies the change only if that insert was new. A statement is atomic, so the mark and the change land together or not at all. A repeated event writes nothing and answers 200.
4. **Ordering.** `users.clerk_updated_at` holds the time Clerk gave to the last applied event (the user's own `updated_at`, or the event time for a deletion). A change is applied only when it is newer, so an older event that arrives late is recorded and changes nothing. A deletion wins a tie with an update of the same millisecond.
5. **What is mirrored.** `user.created` and `user.updated` do the same upsert by `clerk_id`: username, display name, an https avatar and the canonical email of the **verified primary** email. The language comes from Clerk only when the row is created. The role, privacy, bio and `deleted_at` are never in the update, so this endpoint cannot make anyone an administrator.
6. **Deletion.** _Replaced by [ADR-014](014-account-deletion-erases-everything.md) on 2026-10-24: the account is now erased completely and the username and the email are freed. What follows is the first design._ `user.deleted` sets `deleted_at` and clears the display name, avatar and bio. The row stays so the username, the Clerk id and the canonical email stay reserved. A deleted account is not brought back by a later update. The rest of the erasure and the export are SAG-12.
7. **Refused accounts.** An account with a reserved or malformed username, no verified primary email, or a username or canonical email that another account already holds, gets no mirror row. The event is recorded and a `clerk.user_rejected` row goes to the outbox with only the Clerk id and the reason, never an email or a username, so a later job can decide what to do. Nothing is deleted in Clerk here.
8. **Failure.** A database error answers 500 so Svix retries, and logs only the event id, its type and the error name.

Tests: unit tests for the planning rules and the route (valid, forged, missing, tampered, replayed, oversized, rate limited, no secret, database failure), and integration tests on a real Postgres for replay, ordering, deletion and refusals. Breaking the ordering guard or the idempotency mark on purpose makes them fail.

## Verified facts

Read on 2026-10-21 from Clerk's pricing and documentation:

- **Free (Hobby) plan:** 50,000 retained users and a fixed 7-day session. It includes breached-password rejection, disposable-email blocking, subaddress blocking and bot protection at sign-up.
- **Not in the free plan:** multi-factor authentication, passkeys, and allow and block lists.
- **Webhooks** are delivered by Svix, at least once and in no guaranteed order, so SAG-11 must be idempotent and order-safe.
- **Measured locally in SAG-10:** the SDK runs in `workerd` and verifies valid, missing, expired and forged tokens without a network call, with about 1 ms of overhead. The Worker grew from about 216 to about 291 kB gzip for the SDK alone, and the server bundle reached about 481 kB gzip once the sign-in components were included, still far below the Free plan limit.

## Hardening after a review (2026-10-25, SAG-18)

- **A session token is accepted only for the site that was asked.** The auth middleware passes `authorizedParties: [origin of the request]` to Clerk, so a token made for another subdomain of the domain (the `azp` claim) is refused. The origin comes from each request, so previews accept the tokens of their own address.
- **The size of a body is counted, not only declared.** `server/http/body.ts` reads a form or a webhook with a limit on the bytes that arrive, because a client can leave `Content-Length` out or lie about it. Every form and the webhook use it.

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

- CPU time in a real Cloudflare Worker (the Free plan allows 10 ms per request, and going over answers error 1102 per the [limits page](https://developers.cloudflare.com/workers/platform/limits/), read 2026-10-22) is **still not measured on Cloudflare**. Local numbers exist (next section), and the real ones are read from Workers Observability (`$workers.cpuTimeMs`, with the median and P99 in the Query Builder, grouped by route and by version). Until then the figure in the Cloudflare dashboard, a median of about 19 ms for the active production version on 2026-10-22 with a 0% error rate, is unexplained: it could be mostly cold starts, and the plan of the account (Free or Paid) was not checked.

## CPU cost, measured locally on 2026-10-22

The production build (2.86 MiB raw, 620 KiB gzip as `wrangler check startup` counts it, against the 3 MiB gzip limit of the Free plan) was run in workerd with `vite preview`. This is a local machine, so read the figures as a ranking and not as milliseconds on Cloudflare.

- **A warm request is cheap.** 1 to 3 ms (median) for `/`, `/sign-in`, the 404 page and `/api/health`, with a maximum of 5 ms over 60 requests each. Whole milliseconds of wall time from the local spans, which with no network is close to CPU time.
- **The first request after a cold start is not.** About 95 to 100 ms (three runs: 98, 100 and 101 ms), because `workers/app.ts` loads the whole server build with a lazy `import()`, so its 2.4 MiB are evaluated during that first request and not in the startup phase. `wrangler check startup` only sees the startup phase: 19.8 ms of active time (the limit for startup is 1 second).
- **What the first request spends** (a CPU profile taken through workerd's inspector, about 63 ms of JavaScript): about 18 ms evaluating the server build, about 13 ms rendering React for the first time, and about **10 ms in `getClientLocales`** of `remix-i18next`, which calls `new Intl.Locale` and `Intl.DateTimeFormat.supportedLocalesOf` and so loads ICU's locale data once per isolate. Evaluating the 20 Drizzle table definitions costs about 3 ms.
- **Minifying the server bundle did not help.** It cut the bundle from 2400 to 1122 KiB, but the first request stayed at 93 to 97 ms. The cost is running the code, not reading it. The change was not kept.
- **A measurement that is not evidence:** timing `import()` of each package in a fresh Node process ranked Drizzle and Clerk high, but Node loads hundreds of loose files and the bundle is one file, so it was discarded.
- **What it means:** if Cloudflare counts the first request after a cold start in the 10 ms limit, a site with little traffic, where most requests start a new isolate, could be near it. The docs say that isolates tolerate occasional overruns, so one cold request is not by itself a failure, but this is not verified.
- **Options if real data says there is a problem:** parse `Accept-Language` for the two languages ourselves, without `Intl` (about 10 ms of the cold request, once per isolate, and only for a first visit with no language cookie); import the database schema only where it is used (about 3 ms); or the Paid plan, which has no 10 ms limit. A change that keeps the Clerk script, React or Zod out of the first request is not possible with the server build as it is, because React Router loads every route module together.
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

## Changes made in SAG-12

- Clerk's script now also runs on `/settings/*`, with a narrow policy, because the 60 second session token cannot be renewed on a page without it. The earlier decision, "no Clerk code outside the sign-in and sign-up pages", assumed that the server-side session was enough.
- A visitor with no session is sent to sign in with a redirect to a **whole new page** (`redirectDocument`), because the sign-in page has its own policy and a move inside the page left it blank. The way back is the page itself, never the `.data` request of React Router, and always a path on this site.
- Alternatives considered for the expired token: let the server validate an expired token against Clerk's API on each form save (strict policy, no script, but custom security code and a network call per save), or tell the person to save quickly (a poor experience, and the typed text is lost). Neither was chosen.

### What Cloudflare showed, and the first change (2026-10-22)

- **Real figures** (Workers Observability, the last hour, about 30 requests, which include test requests and visits to a preview): CPU **median 28 ms**, P75 49 ms, P90 75 ms, P95 and P99 80 ms. Wall time: median 54 ms, P90 1243 ms, P99 1469 ms. The peaks of more than a second of wall time look like something other than CPU (the database waking up is the guess, not verified). The CPU figures agree with the local measurement of a cold first request, so the cost of a cold start is the likely cause.
- **The change:** `workers/app.ts` imports the server build at the top (`import * as serverBuild`) instead of with a lazy `import()`. Locally the first request after a cold start fell from about 97 ms to about 50 ms (47, 50 and 51 ms), and the startup phase rose from 19.8 to 37.1 ms of active CPU. The work moves to the start of the Worker, which has its own limit of 1 second.
- **Not verified:** whether Cloudflare counts the work of starting in the `cpuTimeMs` of the first request. It is settled by deploying this to a preview and reading the same Observability query again (the preview and production share the Worker name, and each log line carries the version and, for a preview, its name). If `cpuTimeMs` does not fall for cold requests, revert it: the lazy import is Cloudflare's own template.

### Result of the preview test, and the revert (2026-10-23)

The change above was deployed to the preview (commit `ad798fc`) and measured with three rounds of requests, 11 minutes apart, so that the first request of each round met a cold isolate. Each round asked for `/` twice, `/sign-in` and a 404 page. `cpuTimeMs` comes from Workers Observability, filtered by time range. Twelve requests per environment is a small sample.

CPU in ms, preview with the eager import:

| Round (CST, 2026-10-22) | `/` first | `/` second | `/sign-in` | `/nope` (404) |
| ----------------------- | --------- | ---------- | ---------- | ------------- |
| 1, 16:39                | 43        | 79         | 44         | 16            |
| 2, 16:50                | 41        | 40         | 87         | 11            |
| 3, 17:01                | 78        | 40         | 41         | 17            |

CPU in ms, production at the time (code of `main`, lazy import), same rounds:

| Round (CST, 2026-10-23) | `/` first | `/` second | `/sign-in` (503) | `/nope` (404) |
| ----------------------- | --------- | ---------- | ---------------- | ------------- |
| 1, 12:03                | 34        | 32         | 34               | 66            |
| 2, 12:14                | 34        | 14         | 57               | 68            |
| 3, 12:25                | 92        | 57         | 96               | 10            |

- **No measurable gain.** The preview had a median of about 41 ms and peaks of 78, 79 and 87. Production had a median of about 45 ms and peaks of 92 and 96. The peaks stayed near the 80 ms seen before the change, so Cloudflare does not seem to leave the startup work out of the request CPU, or the cost is not where the local measurement put it. Which of the two was not established.
- **The peaks do not follow the cold request.** In the preview the peaks fell on the second `/` (round 1), on `/sign-in` (round 2) and on the first `/` (round 3). The cause (several isolates, or a first visit to each route) was not identified.
- **The Free plan limit of 10 ms is exceeded in both environments.** Almost every request that renders a page is between 30 and 100 ms, warm or cold. Only the 404 pages in the preview and a few single requests were lower. The limit is not met by the startup phase alone.
- **Clerk is not the main cause.** Production, which had no Clerk keys at the time, shows the same range as the preview, which does. An earlier guess that Clerk's work explained the preview figures is dropped.
- **Production had no Clerk keys.** `/sign-in` answered 503 in all three rounds, which is the designed answer of the route when the keys are missing (`auth_not_configured`). Before this branch is merged, the keys must be set as Workers secrets for production, or sign-in and the settings pages will not work there.
- **Decision:** the eager import is reverted, because it did not show a gain and the lazy import is Cloudflare's own template. This does not solve the CPU limit. The options left are a smaller bundle (2.4 MiB today) or the paid plan, and each needs its own ticket and measurement. A single request from the visits of 2026-10-22 to `sagashelf.app` showed 8 and 9 ms warm, but the rounds above do not repeat it.

### CPU measured on production after the merge (2026-10-23)

The same rounds were run against `sagashelf.app` after SAG-12 reached `main` (the lazy import, the production Clerk keys in place, `/sign-in` answering 200). **Two copies of the script ran at the same time by mistake**, started 9 seconds apart, so each round has two sets of 4 requests. Both sets are kept, because the second one reached an isolate the first had just used. The 24 figures are from Workers Observability, host `sagashelf.app`, CST, with a bot probe and one request of the owner left out.

CPU in ms (first set, then second set, each `/` first, `/` second, `/sign-in`, `/nope`):

| Round (CST) | First set      | Second set     |
| ----------- | -------------- | -------------- |
| 16:36       | 40, 68, 42, 22 | 9, 7, 7, 39    |
| 16:47       | 41, 99, 40, 10 | 40, 8, 86, 10  |
| 16:58       | 19, 43, 22, 40 | 73, 13, 14, 15 |

- **Median about 30 ms**, with the figures in two groups: 12 of 24 requests between 7 and 22 ms, and 12 between 39 and 99 ms (peaks of 99, 86 and 73). On 2026-10-23 before the merge the median was about 45 ms with peaks of 92 and 96, from a smaller sample and another version of the code, so it is not a comparison of one change.
- **A request can cost less than 10 ms**: the pages of the second set of the first round took 7 to 9 ms. A request that renders a page costs 40 to 99 ms when it is not that lucky.
- **There is no clean cold and warm pattern.** The second `/` of a set cost more than the first in several rounds (68, 99 and 43 against 40, 41 and 19), so the extra cost is not always on the first request after a pause. The cause (more than one isolate, or the first visit of an isolate to a route) was not found.
- **No request failed**: 0 errors in the 26 events of the window, although most of them are above the 10 ms of the Free plan. The paid plan would remove the limit, but nothing here shows the Free plan cutting a request.
