# Architecture

SagaShelf is one full-stack app: server-rendered pages, API routes and webhooks in a single Cloudflare Worker, backed by Postgres and a few third-party services. This page is the overview. The reasons behind each choice are in the [decision records](adr/README.md).

## Legend

Green boxes exist today. Gray dashed boxes are designed and ticketed but not built yet.

## 1. System overview

```mermaid
flowchart LR
  user["Visitor's browser"]

  subgraph cf["Cloudflare"]
    edge["Edge: DNS, TLS, WAF, bot rules<br/>dashboard setup, SAG-7"]
    subgraph worker["Worker: sagashelf"]
      ssr["Server-rendered pages and resource routes<br/>app/routes"]
      srv["server/: env, database, providers, services"]
      cron["scheduled handler<br/>Cron, every minute"]
    end
  end

  neon[("Neon Postgres<br/>planned, SAG-9")]
  clerk["Clerk accounts<br/>sessions (SAG-10) and user webhook (SAG-11) built"]
  providers["Data providers<br/>TMDB, TVmaze, Wikidata,<br/>Open Library, Google Books, MangaDex<br/>planned, SAG-13 to SAG-16"]
  discord["Discord webhooks<br/>planned, SAG-27"]
  gh["GitHub<br/>repository, Actions, ruleset"]

  user --> edge --> ssr
  ssr --> srv
  srv --> neon
  srv --> providers
  user -. sign-in .-> clerk
  clerk -. webhooks .-> ssr
  cron --> srv
  srv --> discord
  gh -. "push to main, pull requests" .-> cf

  classDef built fill:#d1fae5,stroke:#047857,color:#064e3b
  classDef planned fill:#f3f4f6,stroke:#6b7280,stroke-dasharray:4 3,color:#374151
  class user,ssr,srv,cron,gh built
  class edge,neon,clerk,providers,discord planned
```

Today the Worker serves the home page, the 404 and error pages, `/api/health` and `/api/locale`, and adds security headers (including a CSP with a nonce for pages) to every response. The edge settings are steps in the dashboard ([edge setup](edge-setup.md), [ADR-011](adr/011-edge-security-and-domain.md)). `server/` holds the validated environment module. The `scheduled` handler exists and does nothing yet.

## 2. Life of a request

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant W as Worker
  participant M as i18next middleware
  participant R as Route loader

  B->>W: GET / with Cookie and Accept-Language
  W->>M: root middleware runs first
  M->>M: language is the cookie, else Accept-Language, else Spanish
  M->>R: continue with the language and an i18next instance in context
  R-->>W: loader data with translated title and description
  W-->>B: HTML with lang set and Vary on Cookie and Accept-Language
  Note over B,W: Clerk session check runs after i18next. Protected routes use requireUser and requireRole (SAG-10)

  B->>W: POST /api/locale with language and redirectTo
  W->>W: check Origin, validate with Zod, allow only paths on this site
  W-->>B: 303 back to the same page with Set-Cookie locale
```

See [ADR-008](adr/008-i18n-spanish-default.md) for the language rules and [ADR-006](adr/006-security-model.md) for the checks applied to every state-changing route.

## 3. Search pipeline (planned)

```mermaid
flowchart TD
  q["Query and selected type"] --> n["Normalize: trim, NFKC, lowercase, no accents"]
  n --> l["Search Postgres: tsvector and pg_trgm"]
  l --> enough{"Enough good hits?"}
  enough -- yes --> ans["Answer, target p95 under 150 ms"]
  enough -- no --> cache{"In the edge cache?"}
  cache -- hit --> ans
  cache -- miss --> fan["Parallel fan-out to the providers of that type<br/>timeout about 2.5 s each, circuit breaker"]
  fan --> merge["Merge, de-duplicate, rank"]
  merge --> part["Return what arrived by about 3 s<br/>and mark sources that did not answer"]
  merge --> keep["Persist only items a user opens or adds,<br/>within each provider's terms"]
  keep -.-> l

  classDef planned fill:#f3f4f6,stroke:#6b7280,stroke-dasharray:4 3,color:#374151
  class q,n,l,enough,ans,cache,fan,merge,part,keep planned
```

Providers by type: movies, series and anime use TMDB. Books use Open Library with Google Books as a fallback. Manga uses MangaDex plus the book providers. Details and the constraints that come from each provider's terms are in [ADR-004](adr/004-search-strategy.md) and [ADR-005](adr/005-providers-and-licensing.md).

## 4. Outbox and outgoing webhooks (planned)

```mermaid
sequenceDiagram
  participant U as User action
  participant DB as Postgres
  participant C as Cron handler, every minute
  participant D as Discord webhook

  U->>DB: change plus outbox event in one transaction
  C->>DB: read pending events
  C->>D: POST the event, signed, with an idempotency key
  alt delivered
    D-->>C: 2xx
    C->>DB: mark delivered and log the delivery
  else rate limited or server error
    D-->>C: 429 or 5xx
    C->>DB: schedule a retry with backoff and jitter
  else permanent failure
    D-->>C: other 4xx
    C->>DB: log it and disable the endpoint after N failures
  end
```

See [ADR-007](adr/007-background-work-cron-and-outbox.md).

## 5. Data model

```mermaid
erDiagram
  USERS ||--o{ LIBRARY_ENTRIES : tracks
  MEDIA_ITEMS ||--o{ LIBRARY_ENTRIES : "is tracked in"
  MEDIA_ITEMS ||--o{ MEDIA_EXTERNAL_IDS : "is known by"
  MEDIA_ITEMS ||--o{ MEDIA_PARTS : "has episodes or volumes"
  SAGAS ||--o{ SAGA_MEMBERS : groups
  MEDIA_ITEMS ||--o{ SAGA_MEMBERS : "belongs to"
  USERS ||--o{ FOLLOWS : "follows or is followed"
  USERS ||--o{ LISTS : owns
  LISTS ||--o{ LIST_ITEMS : contains
  USERS ||--o{ WEBHOOK_ENDPOINTS : configures
  WEBHOOK_ENDPOINTS ||--o{ WEBHOOK_DELIVERIES : "has deliveries"
  OUTBOX ||--o{ WEBHOOK_DELIVERIES : produces
  MEDIA_ITEMS ||--o| CUSTOM_ENTRIES : "can be a"
  USERS ||--o{ CUSTOM_ENTRIES : creates
  USERS ||--o{ BLOCKS : blocks
  USERS ||--o{ ACTIVITY : does
  ACTIVITY ||--o{ LIKES : gets
  USERS ||--o{ LIKES : gives
  USERS ||--o{ REPORTS : files
  USERS ||--o{ AUDIT_LOG : "acts in"

  USERS {
    uuid id
    string clerk_id "unique"
    string email_canonical "unique"
    string locale
    string privacy "public, friends or private"
  }
  MEDIA_EXTERNAL_IDS {
    uuid media_id
    string provider
    string external_id "unique with provider"
  }
  LIBRARY_ENTRIES {
    uuid user_id
    uuid media_id "unique with user_id"
    string status
    int progress
  }
```

All 20 tables of SAG-9 exist: users, the catalog, sagas, the library, lists and custom titles, social, moderation, and the outbox and webhook tables. Analytics tables arrive with SAG-24. Only the main tables and relations are drawn; the full list and the rules their constraints enforce are in [ADR-002](adr/002-data-postgres-neon-drizzle.md).

## 6. From a change to production

```mermaid
flowchart LR
  hooks["Local hooks<br/>lint-staged and commitlint"] --> dev["Branch and pull request"]
  dev --> ci["GitHub Actions<br/>Quality, E2E, Lighthouse, PR title,<br/>gitleaks, CodeQL, dependency review, npm audit"]
  dev --> prev["Cloudflare Workers Builds<br/>preview URL for the branch"]
  ci --> rule{"Ruleset: all required checks pass?"}
  prev --> rule
  rule -- yes --> merge["Squash merge to main"]
  merge --> prod["Cloudflare Workers Builds<br/>production deploy"]

  classDef built fill:#d1fae5,stroke:#047857,color:#064e3b
  class hooks,dev,ci,prev,rule,merge,prod built
```

See [ADR-010](adr/010-ci-cd-and-repository-rules.md).

## Environments

| Environment | Where                                  | `APP_ENV`     | Notes                                                      |
| ----------- | -------------------------------------- | ------------- | ---------------------------------------------------------- |
| Local       | `npm run dev`, <http://localhost:5173> | `production`* | Create `.dev.vars` with `APP_ENV=development` to change it |
| Preview     | One URL per branch from Workers Builds | `preview`     | Publicly reachable for now                                 |
| Production  | `sagashelf.moyfdzz.workers.dev`        | `production`  | A custom domain is planned (SAG-7)                         |

\* The default value comes from `wrangler.jsonc`. Nothing reads `APP_ENV` yet.

## Limits that shape the design

These are Cloudflare Workers Free plan limits read on 2026-10-20 (see [ADR-001](adr/001-runtime-react-router-on-workers.md)):

- 10 ms of CPU time per HTTP request and per Cron Trigger invocation
- 50 subrequests per invocation, and Cache API calls count toward it
- 5 Cron Triggers per account, and `waitUntil()` work can run for up to 30 seconds after the response

## Two things to know when writing end-to-end tests

Found while stabilizing the flaky tests (SAG-53, 2026-10-27). The e2e tests run the production build on Miniflare, the local copy of the Workers runtime.

- **The local rate limiter counts in windows fixed to the clock.** Miniflare resets the count at every minute (it was read in `miniflare/dist/src/workers/ratelimit/ratelimit-object.worker.js`), unlike the edge, which is only eventually consistent. A burst can fall in two windows, so a test of a limit of N must send `2N + 1` requests: in at most two windows, one of them gets more than N. A burst of `1.5N` passed or failed depending on the second of the minute in which it ran.
- **An answer given before the body of a POST is read breaks the connection to Miniflare.** The next requests answer 500 (`TypeError: fetch failed`). The CI has no Clerk keys, so every POST to an account route is refused before its body is read. `requireUser` now calls `drainBody` (`server/http/body.ts`) before it refuses; an action that answers early for another reason (an `Origin` that does not match, a rate limit, a body too big) must read the body first, as `answerWithoutReading` does in several routes. On the edge this has no effect, so it was invisible in production.

## Folder map

| Path                            | What lives there                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `app/routes`                    | Pages and resource routes (`api.*`, `webhooks.*`), declared in `app/routes.ts`            |
| `app/components`, `app/lib`     | Code that is safe for the browser. Lint forbids importing `server/` here                  |
| `app/locales`, `app/middleware` | UI text in Spanish and English, and the per-request language selection                    |
| `server/`                       | Environment, database, providers, services and jobs. Never imported by the browser bundle |
| `server/testing`                | The shared MSW mock server used by all tests                                              |
| `workers/app.ts`                | The Worker entry with the `fetch` and `scheduled` handlers                                |
| `e2e`                           | Playwright tests                                                                          |
| `docs`                          | This page and the decision records                                                        |
