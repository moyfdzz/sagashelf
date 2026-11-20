---
paths:
  - "app/routes/**"
  - "app/routes.ts"
  - "app/root.tsx"
  - "app/entry.server.tsx"
  - "server/http/**"
  - "server/auth/**"
  - "server/security-headers.ts"
  - "server/env.ts"
  - "server/runtime-env.ts"
  - "server/trending/**"
  - "public/_headers"
  - "workers/**"
  - "performance-budgets.json"
---

# Routes and security rules

## Every route

- A route reads, calls and answers (ADR-033): parse with Zod (`strictObject` for forms), check, call one function of `server/`, answer.
- **Write endpoints** ask the size and the `Origin` with `checkWrite`, rate limit with `rateLimit(getWriteLimiter(), ...)` keyed by the person, and read bodies with `server/http/body.ts`. The administration uses `readAdminWrite`. Saving a title by opening it (`/media/open`) needs a session and has its own limiter (ADR-035).
- Answers with a person's data are `private, no-store` through `server/http/cache.ts`.
- **`app/routes/write-actions.test.ts` and `read-loaders.test.ts` list every route by who may call it**: a new route goes in the right table.
- Env variables are read only through `server/env.ts` and `server/runtime-env.ts`.
- A route that logs a failure uses `logUnhandled`, never `console.error(error)` (`app/architecture.test.ts` fails on the second; an error can carry the values of a statement).
- **Anything that reads the session goes through `requireUser`, `requireRole` or `getOptionalUser`** (all three send a restricted person to `/account-restricted`); never trust `getAuth` alone. A Clerk lock expires and neither it nor a ban ends open sessions: the app asks `users.moderation_status` on every request (ADR-040).
- **React Router answers a cross-site POST to a page route with a 400 before the action runs** ("The request.url origin does not match origin header"); a resource route reaches its own check (403). An e2e test of a page route accepts 400 or more.
- **A value from the address that must be exactly four digits needs an anchored pattern** (`/^\d{4}$/`) next to the allow list: `Number("2026 ")` is 2026 (SAG-23).
- **A list kept at the edge goes through `withEdgeCopy`** (`server/trending/edge-copy.ts`): the key carries every part that changes the answer. A public copy lags a privacy change by its time to live: say so in `/privacy` and the ADR.
- `app/lib` and `server/` cannot import each other, so a limit used by both is a copy plus a test that compares them (`app/routes/analytics-limits.test.ts`). A component cannot import `server/`: the route re-exports the type.
- **`/api/health` never opens the database** (Playwright waits for it, the CI has no database, and a monitor calling it would keep Neon awake). The database check is `/api/health/database`, which a second uptime monitor calls once a day (`docs/edge-setup.md`, section 17, SAG-260).

## Links

- **Links to a session page** (`/library`, `/settings`, `/sign-out`, `/admin`, `/notifications`) from any other page are plain `<a href>`, never the router's `Link` (ADR-018); also a link **from** a session page to `/u/...`. `/u/...`, `/social`, `/stats`, `/recommendations` and `/sagas` are not session pages.
- **A link to `/media/open` is a plain `<a href>`** (it only redirects). `PosterGrid` has `wholePage` for that; in a render test only a `Link` carries `data-discover="true"`.

## Pages

- The profile page `/u/:username` is public, `private, no-store`, `noindex`, not a session page; its buttons are plain forms with `reloadDocument` posting to its own `action` and ending in a redirect with `?notice=<a known word>`. Lists of people: 50 a page, `?page=` up to 100.
- **A new route with a view needs a line in `performance-budgets.json`** (its size plus 15%), or `check:budgets` fails. Raise a limit only in the PR that adds the weight, and say why.
- **A new admin statistics page also needs:** a row in `read-loaders.test.ts`, the new `server/db` file in `tsconfig.node.json` when a test of `db/` imports it, its table in `db/constraints.integration.test.ts`, and `max-w-3xl` like the other admin pages (a wider one makes the tabs jump).

## Headers and the CSP

- Every Worker response gets the headers of `server/security-headers.ts`, static files those of `public/_headers` (a test keeps both equal); pages get a CSP with a per-page nonce in the production build only. **No inline styles** (`style-src 'self'`).
- **Anything a page loads from another origin needs a test in a real browser under the production CSP.** Pictures from `img.clerk.com` passed every test and were blocked in production (SAG-138). `e2e/security.spec.ts` has the pattern (`page.route` answers for the origin, an `Image` says whether it loaded); run it with `CI=1` and show it fails with the old policy. A new origin goes in one directive, in its own ticket, with a test.

## Worker runtime

- `fetch` init `redirect: "error"` and `credentials` do not exist on Workers.
- `workers/app.ts` wraps the handler in `answerAndDrain` (`server/http/drain-after.ts`): a route never drains its own body (`docs/architecture.md`, end-to-end section).
