# ADR-054: The library writes its activity in the same statement, one event per kind, title and day

- **Status:** Accepted
- **Date:** 2026-11-20
- **Implementation:** Done (SAG-44: the events are written; the feed that reads them is SAG-22)
- **Tickets:** SAG-44, SAG-22

## Context

The table `activity` and its kinds existed since the first schema, but nothing wrote to it, so the feed of SAG-22 had nothing to read. The writer had to fit the runtime and the privacy rules:

- On the Worker a statement is the only atomic unit (Neon over HTTPS, no interactive transaction), and each statement is a subrequest of the 50 an invocation has. An event written in a second statement could exist for a change that was never saved, or be missing for one that was.
- Every change of an entry already goes through `saveEntry` or `rewatchEntry`, which write only if the entry still has the version it had when it was read.
- A person decides who sees each entry and their profile ([ADR-031](031-social-graph.md)), and can change both later.

## Decision

Decided with the owner on 2026-11-20.

- **Which changes are events.** A pure function, `activityOf` in `server/library/activity.ts`, compares the entry before and after: `started` (a planned title is now in progress or paused), `progressed` (the progress went up and nothing bigger happened), `completed`, `dropped`, and `rated` (the score is set and changed). A rewatch is `started` with `rewatch: true`. Pausing, planning again, the notes, the dates, the visibility and adding a title as planned are not events. The notes never go in a payload.
- **One event per person, title, kind and day** (UTC, like the dates of the library). A later one the same day updates the row (its details, its level and its time) instead of adding another, and keeps its id so its likes stay. Ten "+1", a score changed three times or a status switched back and forth show once.
- **Corrections only touch today.** Taking the score away deletes today's `rated`, and lowering the progress (undoing a "+1") puts the new number in today's `progressed`; neither adds an event. An event of an earlier day stays as it was: it is what happened that day.
- **Same statement.** `saveEntry` and `rewatchEntry` write the entry in a CTE named `written`, and `activityCtes` (`server/db/activity.ts`) adds the CTEs that write the events from it. A write that lost the race of the version writes no event and updates none. No new subrequest and nothing in a cron.
- **Level.** An event stores the strictest of the level of the entry (after the change) and of the profile, computed as `GREATEST` of the two enums (`privacy_level` is declared public, friends, private, and an enum compares in that order; a test on the real Postgres keeps it so). The readers (the feed of SAG-22) must check the **current** levels of the entry and the profile again, so making either more private later hides the old events.
- **Private entries write events too**, stored as private: nobody else reads them, the writer has no special case, and they can serve as a personal history later.
- **Removing a title deletes its events** in the same statement, because the page warns that removing it deletes it. One race is left: if a save of the same title commits while the removal waits for the lock of the entry, the event of that save is not in the snapshot of the removal and stays. It cannot be closed in one statement (the snapshot of the other table is taken when the statement starts), so **the feed reads an event only through the current entry of its title** (a join on `library_entries`), which also gives the current level; such an event is never shown, and the erasure of the account deletes it.
- **Imports write no events.** A library import brings hundreds of completed titles at once and would flood the feed of the followers, and it runs in a job with a tight budget.
- **No outbox event.** Nothing consumes one today; the ticket that needs a consumer adds it.
- **Export.** The events of the person are in the full copy of "My data" (`activity`), with the title, the details, the level and the time; `schemaVersion` stays 1 because a field was only added. They are never imported.

## Alternatives considered

- **Writing the event in a second statement after the save.** Simpler SQL, but an event could exist for a change that lost the race, and it costs one more subrequest.
- **Computing the events in SQL from the row before the update.** No change to the signature of the writers, but the rules would live in SQL, where each case is an integration test instead of a unit test.
- **Every step of progress as an event.** Easiest to write, but it fills the feed with noise. **No progress events at all** was simpler still, but hides a person in the middle of a long series.
- **Deleting and inserting the daily event instead of updating it.** Keeps the rows unedited, but drops the likes of the event.
- **Only progress and score as daily events, the status events always new** (the first version of this pull request). The review found that switching a status back and forth would add an event each time.
- **A second statement in `removeEntry` that deletes what the race left.** It closes the race, but it is a second write of one data function (ADR-033) and the feed already has to read through the current entry.
- **The day of the person's time zone.** Fairer for a person in Mexico (the UTC day changes at 6 p.m. in Mexico City), but SagaShelf does not keep a time zone, and the shown time is relative and local anyway.
- **Only hiding the events of a removed title.** Contradicts the warning that says they are deleted.

## Consequences

- `saveEntry` and `rewatchEntry` take the whole entry they read (`ReadEntry`), not only its version, because the events depend on what it was.
- The feed must read every event through the current entry of its title and the current profile; the stored level is only the most an event may show.
- A report on an event (once SAG-22 allows one) can point at an event that removing the title deleted; the moderation panel must show such a report as "content removed".
- An event of a private entry that later becomes public would show to the people that level allows, as the entry itself does.

## Open questions

- What a `list_created` event looks like (the kind exists; lists are not yet written as events). Decide with the owner if lists should appear in the feed.

## References

- `server/db/schema/shared.ts` (`privacy_level` declared as public, friends, private) and `server/db/schema/social.ts` (`activity`), read on 2026-11-20.
- PostgreSQL 18 documentation, "Enumerated Types" (an enum is ordered as its values were listed when it was created): not read again for this ADR; the behavior is checked by `db/activity.integration.test.ts`, run on 2026-11-20.
