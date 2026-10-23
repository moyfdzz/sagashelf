# Architecture decision records

An ADR records one significant decision: what was decided, why, what else was considered, and what it costs. The system overview with diagrams is in [`../architecture.md`](../architecture.md).

## Index

| ADR                                           | Decision                                                                               | Status   | Implementation                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | -------- | ------------------------------------- |
| [001](001-runtime-react-router-on-workers.md) | React Router v8 (framework mode, SSR) on Cloudflare Workers                            | Accepted | Done (SAG-3)                          |
| [002](002-data-postgres-neon-drizzle.md)      | Postgres on Neon with Drizzle                                                          | Accepted | Done (SAG-9)                          |
| [003](003-auth-clerk.md)                      | Clerk for accounts, local `users` mirror                                               | Accepted | Partial (SAG-10 built, SAG-11 next)   |
| [004](004-search-strategy.md)                 | Search: local first, parallel typed fan-out, fallback chains, caching                  | Accepted | Planned (SAG-15)                      |
| [005](005-providers-and-licensing.md)         | Data providers, their terms, and the ones we do not use                                | Accepted | Planned (SAG-13, 14, 16)              |
| [006](006-security-model.md)                  | Threat model, controls and where they live                                             | Accepted | Partial (see the ADR)                 |
| [007](007-background-work-cron-and-outbox.md) | One Cron Trigger handler plus a transactional outbox                                   | Accepted | Planned (SAG-27)                      |
| [008](008-i18n-spanish-default.md)            | Spanish by default, English selectable                                                 | Accepted | Done (SAG-8)                          |
| [009](009-analytics-cookieless.md)            | Cookieless first-party analytics with daily rollups                                    | Accepted | Planned (SAG-24)                      |
| [010](010-ci-cd-and-repository-rules.md)      | CI, security scans, previews and the `main` ruleset                                    | Accepted | Done (SAG-5)                          |
| [011](011-edge-security-and-domain.md)        | Domain, security headers, CSP with nonces, rate limiting and crawler policy            | Accepted | Partial (SAG-7, plus dashboard steps) |
| [012](012-neon-over-supabase.md)              | Neon for the database, compared with Supabase on the Free plan                         | Accepted | Done (SAG-9)                          |
| [013](013-color-palette-and-theme.md)         | Color palette "Marino y ámbar", and light or dark mode with the system as the fallback | Accepted | Done (SAG-12)                         |

"Accepted" means the decision is made. "Planned" means it is not built yet, so the ADR describes the intended design and may be refined by its ticket without a new ADR as long as the decision itself does not change.

## How to write one

1. Copy [`template.md`](template.md) to the next number, for example `011-short-title.md`, and add it to the index above.
2. Fill every section. Write what was verified and where (with the date), and list what could not be verified as an open question instead of guessing.
3. Open a PR with the ticket in the title. The PR is where the decision is discussed.

An accepted ADR is not rewritten when the decision changes. Write a new ADR, set the old one to `Superseded by ADR-NNN`, and link both ways. Typos and factual corrections are fine to edit in place.

## Facts that were checked

Several ADRs rely on limits and terms published by third parties (Cloudflare and the data providers). They were read from the official pages on 2026-10-20 and each ADR lists its sources. These pages change, so treat a limit or a license term as true only until the next time someone reads the page. Anything an ADR marks as _not verified_ must be checked before the code that depends on it is built.
