# ADR-002: Postgres on Neon with Drizzle

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Planned (SAG-9)
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
- **Keys and timestamps:** UUIDv7 ids, `created_at` and `updated_at` on every table, soft delete (`deleted_at`) where a row must disappear from the product but be kept for integrity, for example users.
- **Search support:** `tsvector` with a GIN index, `pg_trgm` for fuzzy titles, `unaccent`, and `citext` for case-insensitive unique values such as usernames. Partial indexes support privacy filters.
- **Planned tables** (SAG-9): `users`, `media_items`, `media_external_ids`, `media_parts`, `sagas`, `saga_members`, `library_entries`, `lists`, `list_items`, `custom_entries`, `follows`, `blocks`, `activity`, `likes`, `reports`, `audit_log`, `outbox`, `webhook_endpoints`, `webhook_deliveries`, `processed_webhooks`, and analytics tables (SAG-24).
- **Tests:** constraint tests (duplicate external id, duplicate follow, duplicate webhook event) run against a real throwaway Postgres in CI, not against a mock.

## Alternatives considered

- **MongoDB (the prototype).** Joins across users, library and sagas become application code, and the idempotency and uniqueness rules above are easier to guarantee with relational constraints. Rejected.
- **Cloudflare D1 (SQLite).** Same platform, but the search design relies on Postgres extensions (`pg_trgm`, `citext`, `unaccent`, `tsvector`). Rejected for this design.
- **A different hosted Postgres or an ORM other than Drizzle.** Not evaluated in depth. Neon has a serverless driver suited to Workers, and Drizzle keeps SQL close to the code with typed schemas.

## Consequences

**Good**

- Integrity is enforced by the database, so a bug in the application cannot create duplicates that the constraints forbid.
- One engine for relational data, text search and the outbox (ADR-007).

**Costs and risks**

- A Worker opens connections per request, so the serverless driver is required, and the distance between the Worker and the Neon region adds latency to every query.
- Extensions and migrations must be reviewed carefully, because a bad migration runs against production data.
- Backups and restore are Neon features. A point-in-time restore on a branch must be tested before launch (SAG-29).

## Open questions

- The limits of Neon's free plan (storage, compute hours, connections, history window) were **not verified** here. Check them when the project is created in SAG-9 and record them in that ticket.
- Whether the Worker should be placed near the database region (Smart Placement). Measure after the first real queries.

## References

- Ticket SAG-9, SAG-15 and SAG-11 (Linear)
