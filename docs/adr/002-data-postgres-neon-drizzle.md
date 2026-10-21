# ADR-002: Postgres on Neon with Drizzle

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Partial. SAG-9 part 1 (tooling, the core tables, tests, seed) is done; the remaining tables follow in part 2.
- **Tickets:** SAG-9, SAG-15, SAG-11

## Context

The data is relational: users, a catalog of media items from several providers, sagas that group items, per-user library entries, follows, blocks, lists, activity, and webhook records. Several rules depend on database constraints, not on application code:

- the same item from two providers must not be stored twice (unique provider and external id),
- a user cannot follow the same person twice,
- an incoming webhook event must be processed once (unique provider and event id).

Search also needs fuzzy matching on titles with accents. The first prototype used MongoDB.

## Decision

- **Database:** PostgreSQL on **Neon** (free plan, created by the owner), one branch for previews and CI. The connection string exists only as a Workers secret (`DATABASE_URL`), and the Neon serverless driver is used from Workers.
- **Access layer:** **Drizzle** with the schema and versioned migrations in `drizzle/`. Migrations run in CI or at deploy time, never while serving a request.
- **Driver on Workers:** the Neon serverless driver over HTTP (`drizzle-orm/neon-http`). Each query is one HTTPS request and counts toward the Free plan's 50 subrequests per invocation. A transaction is a batch of statements sent together (`db.batch`) with no read in the middle, which is enough for the outbox because ids exist before the batch runs. Interactive transactions would need the WebSocket driver or Hyperdrive.
- **Postgres 18**, chosen when the project is created (the major version cannot be changed afterwards), for the built-in `uuidv7()`. `pg_trgm`, `citext` and `unaccent` are available on Neon for every supported version.
- **Local and test database:** the official `postgres:18` image through Docker (`npm run db:up`): `sagashelf` for development and `sagashelf_test`, which the integration tests drop and rebuild from the real migration files on every run. The tests refuse any database that is not local and named `*_test`.
- **Migrations are applied by hand** with `npm run db:migrate` from the owner's terminal, with `DATABASE_URL` set only in that terminal. Without it the command runs against the local database. Automating this in CI needs a database credential stored in GitHub and is left for a later ticket.
- **Migration files:** `0000` creates the extensions and `immutable_unaccent` (Postgres' `unaccent()` is not allowed in generated columns or indexes), `0001` holds the tables Drizzle generates, and `0002` holds the fuzzy-title indexes that Drizzle cannot express. An applied migration is never edited.
- **Keys and timestamps:** UUIDv7 ids, `created_at` and `updated_at` on every table, soft delete (`deleted_at`) where a row must disappear from the product but be kept for integrity, for example users.
- **Search support:** `tsvector` with a GIN index, `pg_trgm` for fuzzy titles, `unaccent`, and `citext` for case-insensitive unique values such as usernames. Partial indexes support privacy filters.
- **Planned tables** (SAG-9): `users`, `media_items`, `media_external_ids`, `media_parts`, `sagas`, `saga_members`, `library_entries`, `lists`, `list_items`, `custom_entries`, `follows`, `blocks`, `activity`, `likes`, `reports`, `audit_log`, `outbox`, `webhook_endpoints`, `webhook_deliveries`, `processed_webhooks`, and analytics tables (SAG-24).
- **Tests:** constraint tests (duplicate external id, duplicate follow, duplicate webhook event) run against a real throwaway Postgres in CI, not against a mock.

## Alternatives considered

- **MongoDB (the prototype).** Joins across users, library and sagas become application code, and the idempotency and uniqueness rules above are easier to guarantee with relational constraints. Rejected.
- **Cloudflare D1 (SQLite).** Same platform, but the search design relies on Postgres extensions (`pg_trgm`, `citext`, `unaccent`, `tsvector`). Rejected for this design.
- **A different hosted Postgres or an ORM other than Drizzle.** Not evaluated in depth. Neon has a serverless driver suited to Workers, and Drizzle keeps SQL close to the code with typed schemas.
- **Hyperdrive (Cloudflare) with a native Postgres driver.** Neon's guide recommends it for Workers. It pools connections and allows full transactions, but adds a Cloudflare resource with its own configuration per environment, needs the non-pooled connection string, and how its queries count toward the Free plan limits was not verified. It is the next step if latency or the subrequest limit becomes a problem.
- **PGlite (Postgres in memory) for the tests.** It needs no Docker and bundles `pg_trgm`, `citext` and `unaccent`, but it is not Postgres 18 and has no built-in `uuidv7()`. Real Postgres 18 in Docker is closer to production.

## Consequences

**Good**

- Integrity is enforced by the database, so a bug in the application cannot create duplicates that the constraints forbid.
- One engine for relational data, text search and the outbox (ADR-007).

**Costs and risks**

- A Worker opens connections per request, so the serverless driver is required, and the distance between the Worker and the Neon region adds latency to every query.
- Extensions and migrations must be reviewed carefully, because a bad migration runs against production data.
- Backups and restore are Neon features, and on the Free plan the restore window is only **6 hours** (history is capped at 1 GB-month). A point-in-time restore on a branch must be tested before launch (SAG-29), and a longer window needs a paid plan.
- **Neon Free plan limits** (read 2026-10-21): 1 GB of storage per project, 100 compute hours per project per month, 10 branches per project, 5 GB of egress per month, no credit card. The compute shuts down after 5 minutes without queries and this cannot be disabled, so the first query after a pause is slower. A 0.25 CU compute that never pauses would use about 180 hours in a month, so steady traffic can use up the free hours (see ADR-009). What happens when they run out was not stated.
- With the HTTP driver, every query uses one of the Worker's 50 subrequests, so a loader should make a handful of queries, not dozens.

## Open questions

- Neon's maximum number of connections is not stated on the pages read. It matters little with the HTTP driver. Check it if Hyperdrive or a pool is adopted.
- Whether the Worker should be placed near the database region (Smart Placement). Measure after the first real queries.

## References

- Ticket SAG-9, SAG-15 and SAG-11 (Linear)
