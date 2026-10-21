# ADR-012: Neon for the database, and how it compares with Supabase

- **Status:** Accepted
- **Date:** 2026-10-21
- **Implementation:** Done (a Neon project exists; the schema is built in SAG-9)
- **Tickets:** SAG-9
- **Related:** [ADR-002](002-data-postgres-neon-drizzle.md), [ADR-003](003-auth-clerk.md)

## Context

The owner chose Neon for the database as part of the project's starting stack. ADR-002 recorded why Postgres, but it only said that "a different hosted Postgres" was "not evaluated in depth". Supabase is the most common alternative, so this ADR compares the two on the points that matter here and records why Neon stays. The decision itself is not reopened: the comparison is there so the reasons are written down and the conditions for changing one's mind are clear.

What the project needs from its database:

- Plain Postgres with `pg_trgm`, `citext`, `unaccent` and `uuidv7()` (ADR-002), used through Drizzle.
- Access from Cloudflare Workers on the Free plan, where each query is one subrequest out of 50 (ADR-001).
- A separate database for pull request previews, without copying production data into public preview URLs.
- A free plan that a low-traffic portfolio can live on, with no credit card and no surprises.
- Accounts handled by Clerk (ADR-003), so a bundled authentication service is not needed.

## Decision

**Keep Neon.** The comparison below was read from the official pages of both products on 2026-10-21.

| Point                       | Neon (Free plan)                                                                                                      | Supabase (Free plan)                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Storage per project**     | 1 GB (20 GB across the account)                                                                                       | 500 MB, with 2 active projects                                                                                                                               |
| **Database branches**       | **Included**: 10 per project, created instantly, storage used only for changes                                        | **Not included on Free**: branching starts on the Pro plan (priced per branch per hour), and branches are data-less by default                               |
| **Inactivity**              | The compute pauses after 5 minutes (scale to zero) and starts again on the next query; no manual restore is mentioned | "Free projects are paused after 1 week of inactivity" and must be restored from the dashboard (a 1-year restore window)                                      |
| **Compute**                 | Scale to zero, 100 compute hours per project per month, so a database that never sleeps can run out                   | Shared CPU, 500 MB RAM, always on, with no compute-hour cap stated; 60 direct connections                                                                    |
| **Backups and restore**     | 6 hours of history for point-in-time restore                                                                          | **No automatic backups and no point-in-time recovery on Free**; the docs advise exporting the data yourself                                                  |
| **From Cloudflare Workers** | Serverless driver over HTTP, no connection to keep alive; Hyperdrive is recommended by Neon for heavier use           | The shared pooler in transaction mode with prepared statements off, or Hyperdrive with the direct connection (IPv6 on Free); an HTTP driver was not verified |
| **Postgres versions**       | 14 to 18, chosen at creation                                                                                          | The default for new projects was not stated on the pages read                                                                                                |
| **Extensions we need**      | `pg_trgm`, `citext`, `unaccent` and native `uuidv7()` (Postgres 18) listed                                            | "Over 50 extensions"; the three we need were **not listed** on the page read and must be confirmed on a real project                                         |
| **Bundled products**        | Postgres only                                                                                                         | Auth, Storage, Realtime, REST and GraphQL APIs, all optional; the database works as standalone Postgres, and the APIs require Row Level Security             |
| **Credit card on Free**     | Not required                                                                                                          | Not stated on the pages read                                                                                                                                 |

### Why Neon wins for this project

1. **Branches on the Free plan.** Previews need their own database. Neon gives that for free, and a branch can be created from the schema only. Supabase branching is a paid feature.
2. **No manual restore after quiet weeks.** A portfolio can go a week without visitors. Neon's compute pauses after five minutes and starts again on the next query, and its pages mention no manual restore. A paused Supabase Free project has to be restored from the dashboard, which could leave the site failing until someone notices.
3. **More room and a restore window.** 1 GB against 500 MB, and 6 hours of point-in-time history against no automatic backups on Free.
4. **A driver that fits Workers.** Neon's HTTP driver needs no connection pooling setup, which keeps the first version simple.
5. **We do not use what Supabase bundles.** Clerk handles accounts (ADR-003), and the product has no file uploads or realtime features planned. Paying the complexity of a platform for products we would not use has no benefit.

### Where Supabase is better

These are real advantages, and they are why this ADR lists conditions for revisiting the choice:

- **No compute-hour cap and no cold start.** The shared instance is always on. Neon's free hours can run out under steady traffic, and the first query after a pause is slower (ADR-002, ADR-009).
- **A bigger platform** if the project ever needs file storage or realtime features, and a dashboard that covers more than the database.
- **Row Level Security tooling** for exposing the database through its REST API. The product does not do that: every query goes through the app's own server code.

## Alternatives considered

- **Supabase.** Compared above. Rejected for the Free plan limits that hit this project (no branches, pausing, no backups), not because it is a worse product.
- **Cloudflare D1.** Same platform, but the search design relies on Postgres extensions (ADR-002).
- **Neon with Hyperdrive.** Not an alternative to Neon but to its HTTP driver. Documented in ADR-002 as the next step.

## Consequences

**Good**

- Previews and tests get their own databases without paid features.
- No manual restore is documented after idle periods (the compute starts again on the next query).

**Costs and risks**

- **The free compute hours are a real limit** (100 hours a month). Constant traffic, or an analytics collector that writes on every page view, can use them up. What happens when they run out is not stated on the pages read.
- **A cold start** after five idle minutes makes the first query slower.
- **Lock-in is small.** The schema, the migrations and the queries are plain Postgres through Drizzle. Moving to Supabase or any other Postgres is a connection string and a driver change, plus the extensions check.

## Revisit this decision if

- The free compute hours run out in a normal month, and the paid Neon plan is not an option.
- The database needs more than 1 GB before there is revenue to pay for it. Supabase Free would not help (500 MB), so this would point to a paid plan on either.
- The project needs file storage or realtime features that would justify a bundled platform.
- Neon changes its Free plan in a way that removes branches or the start-on-query behavior.

## Open questions

- Whether `pg_trgm`, `citext` and `unaccent` are available on Supabase. The page read says "over 50 extensions" without listing them. Confirm on a real project before any move.
- Supabase's serverless driver page for Cloudflare Workers was not read, so an HTTP option there is unverified.
- Whether a credit card is required for a Supabase Free project.
- What Neon does when the free compute hours are used up.

## References (read 2026-10-21)

- Neon pricing, <https://neon.com/pricing> and plans, <https://neon.com/docs/introduction/plans>
- Neon extensions, <https://neon.com/docs/extensions/pg-extensions> and serverless driver, <https://neon.com/docs/serverless/serverless-driver>
- Supabase pricing, <https://supabase.com/pricing>
- Supabase compute and disk, <https://supabase.com/docs/guides/platform/compute-and-disk>
- Supabase backups, <https://supabase.com/docs/guides/platform/backups>
- Supabase branching, <https://supabase.com/docs/guides/deployment/branching>
- Supabase extensions, <https://supabase.com/docs/guides/database/extensions>
- Supabase connecting to Postgres, <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Cloudflare Hyperdrive with Supabase, <https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/>
- Supabase features, <https://supabase.com/docs/guides/getting-started/features>
