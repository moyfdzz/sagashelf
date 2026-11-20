# ADR-055: The feed reads every event through one rule, and a like is only a count

- **Status:** Accepted
- **Date:** 2026-11-20
- **Implementation:** Done (SAG-22, the pull request of the feed and likes)
- **Tickets:** SAG-22, SAG-44

## Context

SAG-44 writes the activity of the library ([ADR-054](054-library-activity-events.md)); nothing read it yet. SAG-22 asked for a feed of the people a person follows, privacy-aware, with likes. Three facts shaped it:

- An event stores the level it had when it was written, but a person can later make the entry or the profile more private, or remove the title. ADR-054 decided that a reader must check the **current** entry and profile, and read an event only through the current entry of its title.
- The rules of who sees what live in `canView` ([ADR-031](031-social-graph.md)), and the SQL must use `levelAllowed` and `blockedBetween` instead of writing them again.
- A like is a write of a person on something another person did, so it must be allowed on exactly what that person may see, and checked in the same statement that writes it (a statement is the only atomic unit on the Worker).

## Decision

Decided with the owner on 2026-11-20.

- **Where.** The feed is on `/social`, under the search of people. No new page.
- **What it shows.** The events of the people the viewer follows and the viewer's own, newest first, 20 a page with a cursor (`?before=`), read on demand. The kinds are started (a rewatch says "started again"), progressed, completed, dropped and rated; `list_created` has no writer yet.
- **One rule for the page and the like.** `shownEvents` in `server/db/feed.ts` joins the event to its author, the **current** library entry of its title and the title, and keeps it when: the author is the viewer; or the viewer follows the author, has not muted them, there is no block either way, and the strictest of the levels of the event, the entry and the profile is one `canView` allows for a follower, or for a friend when the author follows back. Erased authors and titles a person made for themselves (`sharedTitleSql`) are left out. The like statement reads through the same fragment.
- **The viewer's own events** show in their feed, at any level, marked as theirs and with the level when it is not public ("friends only", "only you"), so the person sees the likes they got. They cannot be liked by their author.
- **A like** is one per person and event, idempotent, given or taken back with an explicit yes or no (not a toggle, so a repeated form does not undo it). It is written only if the event is shown to that person; a refused like answers the same 404 whatever the reason, so a like cannot tell whether a hidden event exists. Taking a like back always deletes it and always answers, without the count when the event is hidden now. Rate limit: the existing `WRITE_LIMITER` (30 a minute), key `like:<person>`; over it the page says so. A like stays on its event when the event is corrected the same day (ADR-054 keeps the id so that the likes stay): it is a like of the event, not of its exact numbers.
- **Only the count is shown**, and whether the viewer liked it; never who liked it. A list of names would have to pass every name through the rules of privacy and blocks.
- **No notification for a like** in this ticket. The owner is considering one (grouped, once per person and event, never naming a muted, blocked or Total privacy person, with a switch in the settings); it would be its own ticket.
- **Export, not import.** The likes of a person are in the full copy of "My data" (`likes`): the kind of event and when, and its title only while the feed still shows that event to them (read through the same fragment), never the name of the author, which is what someone else did. They are never imported: a like points at an event of another person in this database, and events are never imported (ADR-054).

## Alternatives considered

- **Filtering the events in JavaScript with `canView`.** It is the one policy, but a page of 20 would shrink after the database chose it, and the pages would not line up. The SQL asks `canView` for the levels instead (`levelAllowed`), which is how the profile pages do it.
- **A cursor of milliseconds.** Postgres keeps microseconds, so an event in the same millisecond as the last one shown could repeat or be skipped. The cursor is the time in microseconds and the id.
- **A separate resource route for the like.** The page's own action is enough; it does not read the page again after a like (`shouldRevalidate`), so a like never repeats the search of people or spends its limit.
- **Only the events of others in the feed.** Simpler, but then the person has nowhere to see the likes they got without notifications.
- **Showing who liked an event.** Friendlier, but each name is one more place where a block or a private profile must be checked; left for later if it is asked for.

## Consequences

- The statement starts from the viewer and the people they follow (`a.actor_id IN (...)`), so it reads the events of those authors through `activity_actor_created_idx` instead of the activity of the whole site. If the feed becomes slow with many follows, an `EXPLAIN` test like the one of `searchLocal` is the next step.
- Over the limit of searches, the search says so and the feed still shows.
- The events of today move up when they are updated (ADR-054), so a page read later can repeat or miss one of those. Each page is read on its own, which is acceptable at this scale.
- A new reader of the feed (a profile tab, a notification of a like) must go through `shownEvents` instead of writing its own join.
- `db/feed.integration.test.ts` holds the table of who sees what, written by hand from ADR-031; a change of `canView` must change it too.

## References

- [ADR-031](031-social-graph.md), [ADR-054](054-library-activity-events.md).
- SAG-22 and the decisions of 2026-11-20 (private ticket repository).
