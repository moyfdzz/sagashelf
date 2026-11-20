---
paths:
  - "server/db/**"
  - "server/social/**"
  - "server/account/**"
  - "db/**"
  - "drizzle/**"
  - "drizzle.config.ts"
  - "tsconfig.node.json"
---

# Database rules

Read before touching a query, the schema, a migration or an integration test. A migration in production is the `apply-migration` skill.

## The runtime shapes every query

- **A statement is the only atomic unit.** The Worker uses Neon over HTTPS (`drizzle-orm/neon-http`): no interactive transaction. Changes that must go together are ONE statement with data-modifying CTEs; each statement is a subrequest of the 50 of an invocation. A boolean that changes the SQL is written as SQL words, not a bound parameter (the Neon driver cannot be tried locally).
- **A statement with data-modifying CTEs cannot see its own changes, and a row cannot be updated twice in one** (the second `UPDATE` is silently ignored). In SAG-242 "nothing is left waiting" is the waiting rows of the snapshot minus the ids the same statement resolves, and the counters and `finished_at` of `import_jobs` are written by one `UPDATE`.
- A data function is one statement with the user id **of the session** in its `WHERE`, and takes the database as a parameter (ADR-033).
- **A query uses an expression index only when it repeats the index expression exactly.** The trigram indexes of `media_items` are on `immutable_unaccent(lower(title))` and `immutable_unaccent(lower(original_title))`; a `coalesce` in the `WHERE` of `searchLocal` made a full scan (SAG-187). `db/search-local.integration.test.ts` reads the `EXPLAIN` and fails on a `Seq Scan`; do the same for any new indexed search.
- **A backtick inside a `sql` template ends the JavaScript string**, even in a `--` comment. Write SQL comments without backticks, or put the comment above the template.
- Drizzle's `$onUpdate` stamps `updated_at` on every update; a setter that must not move an entry up the "changed lately" list sets `updatedAt: sql` of the column itself.
- **Renumbering in SQL:** `row_number()` starts at 1, a stored `position` at 0 (`moveListItem`, SAG-113). Number from 0 and assert that an edge move writes nothing.

## Rules written once (guard tests fail on a copy)

- **Titles a person made for themselves** (`media_items.type = 'custom'`) never come out of a query that shows titles to somebody else. Use `sharedTitleSql` (or `titleShownSql` on a profile page) from `server/db/titles.ts`, even to count (`NOT sharedTitleSql("m")`). `server/db/custom-title-rule.test.ts` reads all of `server/`: a new reader of `media_items` is listed in `showTitlesToOthers` with its number of uses, each `FROM`/`JOIN media_items` matched by one; never raise `readsWithoutTheRule` to pass. **A type guard must keep `custom`** (not a `MediaKind` or `LibraryType`, still listed under "all"): `listTitleView` is the pattern. When `custom_entries` gets its writer (SAG-19), the one fragment changes to `visibility` and `moderation_state`.
- **Who a viewer may be shown:** `listedToViewer` and `reachableByViewer` (`server/db/person-visibility.ts`), `listedPeople` (`server/db/people-lists.ts`), `requesterCardShown` for follow requests (SAG-167: the list, the header count, `acceptRequest` and the export). `visibleLevels` and the pure policies `canView`, `canSeeCard`, `canFollow`, `canRequest` live in `server/social/can-view.ts`; in SQL use `levelAllowed`. `db/people-lists-rule.integration.test.ts` ties the SQL to `canView`: change one and the other must follow. A viewer's own block rows are never filtered by the other person's privacy (or the block could not be undone); blocking also drops the viewer's own mute.
- **Never write a block check by hand: `blockedBetween`.** Only `blocks-mutes.ts` and `account/export.ts` may read `blocks` (`server/db/block-check.test.ts` guards it).
- **No user enumeration:** a missing username, an erased account, a Total privacy profile, a block either way and a profile that may not be seen all answer the same 404 / `null` / `unavailable` (ADR-031).
- **Every reader of `notifications` goes through `readableByOwner`** (`server/db/notifications.ts`, SAG-177): inbox, unread count, header count, export. A new admin-only type is added to that one function. A notification whose payload names another person stores their id (`targetId`) and `erasureCtes` in `server/db/erase-user.ts` deletes it (`erase_report_alerts` is the model).
- **A "who may be shown" rule is not finished until every reader of the table uses it**: `grep` the list, count, export, erasure and notifications (SAG-167's review found the export still naming a hidden person).

## Every new table or column

- A table or column with a person's data is in the erasure (`server/db/erase-user.ts`) and in the export (`server/account/export.ts`); the integration test of the erasure reads every foreign key to `users` and fails otherwise.
- The list of tables in `db/constraints.integration.test.ts` grows with each new table.
- A file under `server/` that a test of `db/` imports must be in the `include` of `tsconfig.node.json`; `npm run typecheck` writes it there (`scripts/sync-tsconfig-node.mjs`), so commit the change. That project cannot type Worker-only code (`cloudflare:workers`), so a `db/` test must not import it, even through another module.
- Schema change: edit `server/db/schema`, `npm run db:generate`, read the SQL, rename the generated file and its `tag` in `drizzle/meta/_journal.json`, add a test for each new constraint in `db/`. Extensions and indexes Drizzle cannot express go in a custom migration.
- **A migration can be edited until the owner applies it** (the test database is rebuilt from the files on every run), but then the local development database and the snapshot in `drizzle/meta` must be aligned by hand. Ask whether it was applied before editing. After it is applied, any change is a new migration.

## Integration tests

- They run on the local Docker Postgres 18 and refuse any database not local and named `*_test`. A second run while one is going is refused by an advisory lock (`db/global-setup.ts`). The integration config has no `~` aliases: test a loader with mocks in `app/routes/*.test.ts` and the data layer against the real Postgres.
- **Write the expected table by hand**; do not ask the function under test.
- Docker Postgres's clock is about 0.15 s ahead of Node's: do not mix `now()` with `Date.now()`.
- **A race test with `Promise.all` proves little** (two statements through one local pool rarely overlap). Interleave on purpose: let the function run a write of its own between its read and its write (`db/library-concurrency.integration.test.ts`).
- With `noUncheckedIndexedAccess` a destructured item may be undefined and the lint forbids `!`: use a helper that throws (`pick` in `db/list-items.integration.test.ts`).
- `db/seed.ts` refuses a database that is not local and starts with a `TRUNCATE`: never work around it.
