# ADR-019: A history of the times a title was watched

- **Status:** Accepted. It supersedes the "Watching again" rule of [ADR-018](018-personal-library.md); the rest of ADR-018 stands.
- **Date:** 2026-10-27
- **Implementation:** Done (SAG-48)
- **Tickets:** SAG-48, SAG-18
- **Related:** [ADR-014](014-account-deletion-erases-everything.md), [ADR-002](002-data-postgres-neon-drizzle.md)

## Context

ADR-018 counted the times a person "watched a title again" with one number on the entry, and "Watch it again" overwrote the dates of the run that ended. A person could not see when they watched a title each time, could not say "I saw it last year", and the number only counted restarts. The owner asked (2026-10-25) to keep when each viewing happened and to say "You have watched it N times".

## Decision

**A table `library_viewings`** (migration `0008`, additive, applied by hand like the earlier ones): `entry_id` (a foreign key to `library_entries` with `ON DELETE CASCADE`), `started_on`, `finished_on`, `notes` (up to 500 characters) and the usual timestamps. A check keeps `finished_on` from being before `started_on`, as the entry does. The dates are optional: somebody may remember they saw a title and not when.

**What is where.** The entry keeps the dates of the **current** run. The table keeps the **earlier, finished** viewings. A title has been watched `earlier viewings + 1 if the entry is completed now` times (`timesWatched` in `server/library/rules.ts`, and the same count in SQL for the list). The library card says "You have watched it N times" from one time on.

**"Watch it again"** saves the run that ends in the table, with its start and finish dates, and restarts the entry, in one SQL statement (`rewatchEntry`), so the run is saved if and only if the entry restarts. The score and the notes stay.

**The entry page** lists the earlier viewings, the latest first, and lets a person add one, change its dates and notes, or remove it. The forms are the same page action with three more intents (`viewing_add`, `viewing_save`, `viewing_remove`). Their fields have their own names (`viewStartedOn`, `viewFinishedOn`, `viewNotes`), so an error says which form it belongs to.

**Who may touch a viewing.** Every query joins the entry of the person of the verified session, so the id of a viewing is not enough to read, change or remove somebody else's. An entry can hold at most **50** earlier viewings. The limit is checked inside the insert, but two requests that arrive at the same instant can both pass it, so it is a soft limit: the write limiter keeps any overshoot to a few rows, and nothing breaks if it happens.

**Export and deletion.** The JSON export has `timesWatched` and the `viewings` of each entry (never an id). The CSV replaces "times watched again" with "times watched" and adds a third table with the viewings, after an empty line. Deleting an entry or an account removes its viewings by the foreign key. The tests that list what an erasure removes and what the export holds cover the table.

**`rewatch_count` is no longer written or read.** The column stays in the table, unused, so the code that was running when the migration was applied still works. It is removed in a later migration, once nothing reads it.

## Alternatives considered

- **Every run, the current one included, as a row.** One list and one count, but the entry would have to stay in step with its current row, and the editor, the card and the import would each need to keep both the same. Keeping the current run on the entry changes nothing for what already works.
- **Move the old counter into the table.** It would turn each "watched again" of the old counter into a viewing with no dates. The owner is the only person with data and has one entry, so the counter was dropped instead. If a title had a counter, it only stops being shown.
- **Drop `rewatch_count` in the same migration.** It is not additive: the code that is still deployed when the migration is applied would fail on the missing column.
- **A trigger that enforces the limit under concurrent requests.** It needs a lock on the entry and a function in a custom migration, for a limit that only protects against a loop of requests and is already slowed by the write limiter.

## Consequences

**Good**

- A person can see every time they watched a title, with its dates, and correct them.
- The card now says how many times a title was watched, not how many times it was restarted.

**Costs and risks**

- Entries that had a "watched again" counter lose that number from the pages (the column still holds it).
- A viewing that is added by hand while the title is "in progress" counts as one watched time, which is what the person said.
- The entry page was checked with unit tests, rendered pages and integration tests against a real database with two people. A full run as a signed-in person was **not** done (the end-to-end tests cannot create a Clerk session): it must be tried in the real site.

## Open questions

- Removing the `rewatch_count` column.
- Whether the viewings should be part of the public profile (SAG-21) and how their notes are hidden.
- The import (SAG-41) will need to read and write viewings.

## References

- Ticket SAG-48 (Linear)
