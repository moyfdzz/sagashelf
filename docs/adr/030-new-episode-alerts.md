# ADR-030: Alerts of new episodes, through the outbox to Discord

- **Status:** Accepted
- **Date:** 2026-11-03
- **Implementation:** Done (SAG-28) for the episodes of series and anime, delivered to Discord. New volumes of manga and books are left out (see "What is not here"). "Do not tell me about this series" was added by SAG-101, and the inbox inside the app by SAG-102.
- **Tickets:** SAG-28, SAG-27, SAG-90
- **Related:** [ADR-007](007-background-work-cron-and-outbox.md), [ADR-018](018-personal-library.md), [ADR-027](027-tvmaze-next-episode.md), [ADR-029](029-discord-webhooks.md), [ADR-012](012-neon-over-supabase.md)

## Context

ADR-027 keeps the next episode of each series (`media_next_episode`) and ADR-029 built the outbox and the delivery to Discord, with the test message as the only event. SAG-28 is the first real event: tell a person that an episode of what they are watching has come out.

Four things in the ticket did not match what exists, and are decided here:

- **The table keeps one row per title, the next episode, and overwrites it.** The job of ADR-027 asks TVmaze again the day after an episode comes out, and saves the episode that follows. Comparing "before" and "after" in that job would tell people about an episode more than a day after it came out.
- **There is data for episodes only.** Nothing in the database says when a new volume of a manga or a book comes out (that is SAG-68), and (until SAG-102) there was no table of notifications inside the app.
- **Nobody receives anything today.** `webhook_endpoints.event_types` is empty by default and the settings page had no way to choose.
- **There is no time zone per person**, only the language (`users.locale`).

## Decision

**An episode is told when its moment has passed, not when the row changes.** One new nullable column, `media_next_episode.announced_stamp` (migration `0018`, additive), holds the `air_stamp` of the last episode that was told for that title. A statement (`announceNewEpisodes` in `server/db/episode-alerts.ts`) takes the rows whose `air_stamp` has passed, is not older than 3 days, and is newer than `announced_stamp`; sets `announced_stamp` to the stamp; and queues the messages, **all in one statement** (data-modifying CTEs, the pattern of ADR-029). A statement is the only atomic unit on the HTTP client of the Worker, so an episode is marked and queued together or neither. Two runs at the same time cannot both tell it: the second waits for the row and then finds it marked (tested with three runs at once). The marker is a moment and not a season and number, so an episode with neither still works.

**The window of 3 days** keeps the first run after the alerts are switched on, or after a long stop, from telling news that is days old. An episode that came out longer ago is not told, and nothing is queued for it.

**Who hears it:** a person who has the title in their library as **"in progress"** (`library_entries.status`), has not turned off the alerts of that title, and has an endpoint that is on and asked for `episode.aired`. An episode nobody hears is still marked, so someone who starts the series later, or turns the alerts of a title back on, is not told old news.

**A switch for each title (SAG-101, migration `0019`).** `library_entries.notify_new_episodes` is on by default, which is what an entry did before there was a switch, so the migration changes nothing for anybody. The page of a series or an anime in the library has a small form of its own, "Alerts for this title", with a box and its own button (`setEntryNotifyNewEpisodes`: one statement, the id of the session in its `WHERE`, and it does not change `updated_at`, because the column is set to itself: Drizzle would otherwise stamp it with `$onUpdate` and silencing a title would move it up the list of what was changed lately). The statement of the alerts only joins entries that have it on. It is part of the export of the account, and an import gives it to a **new** entry as the file says (a file from before the switch reads as on, and only a real `false` turns it off) while an entry the person already has keeps its own, even when it is replaced, like the visibility.

**An inbox inside the app (SAG-102, migration `0020`).** A person who has no webhook, or does not use Discord, never heard of an episode. The same statement now also writes a row in `notifications` (user, type `episode.aired`, a JSON payload with the title in the language of the person, the season, the number and the id of the title, the moment it was made and `read_at`) for **each person** who hears an episode, whether or not they have an endpoint, so the Discord message and the notification come from one cause and one statement. The key of a row (`'episode:' || media id || ':' || air stamp`, unique with the user) makes a repeat harmless. It is **one row per episode**, not a digest: it reads better in a list and is marked one by one. The page is `/notifications`, called "Notifications" (SAG-106 renamed it from "Alerts"; the settings page of the webhooks, which was "Notifications", became "Discord alerts", so each name is used once; the routes did not change), a plain anchor like every session page (ADR-018, and `isSessionPage` gives it the narrow policy with Clerk's script); it lists the 50 newest of the last 30 days, with "Mark as read" for each and "Mark all as read" (`markRead` and `markAllRead`, each one statement with the id of the session in its `WHERE`; a Zod `strictObject`, the `Origin` check and the rate limit, like the other actions). The text of a row is made by the page, in the language of the page, with `episodeLabel` of `server/webhooks/message.ts`, the same function the Discord message uses. The header shows the number of unread ones next to the link and, on the menu button of a phone, a bubble with the same number (the link is in its panel; SAG-106 changed the dot of SAG-102 into the number, which hangs over the corner and adds no width to the row); the count is read in the root loader for a person with a session, in the one statement that also gives the role and the username (`findHeaderFacts`, SAG-114; capped so it never scans a long table, shown as `99+`), and a failure of it is logged by name and says 0. A row is deleted after 30 days by a `DELETE` **in the same statement** of the alerts, so the cleanup costs no request: the budget stays at 43 of the 50. The table is in the erasure of the account (`erasedColumns`; the test that reads the foreign keys fails without it) and in the export (`notifications`, without the id of the row). **What it does not do:** nothing is written for the episodes that came out before it was deployed (the window of 3 days still applies), and, because the job is the hourly one, with `WEBHOOKS_ENABLED` off nothing is written either: the flag switches the whole job off. All the episodes of the moment for that endpoint go in one `episode.aired` event: the first 10 titles (in order of title) and how many there were, so a Sunday night with eight series is one message. The title is in the language of the person (`titles ->> locale`, else the title saved). The key of the event is made from what it tells (the endpoint and a hash of the titles and moments), so even a repeat of the same statement could not queue it twice.

**The text** (`server/webhooks/message.ts`) is "a new episode is out" or "N new episodes are out", then one line per title with season and episode when TVmaze gave them, and "… and N more". It carries **no hour**: TVmaze's date is in the time zone of the network (ADR-027), and the person's own zone is not known, so naming an hour would often be wrong. It mentions nobody (ADR-029). A payload that says nothing is given up on, not sent.

**It is opt-in, per endpoint.** The settings page has one box for each webhook, "New episodes of what you are watching", off until the person ticks it, saved with its own button (`setEndpointEvents`; a Zod `strictObject`, the `Origin` check, the rate limit and the id of the session in the `WHERE`, like the other actions). An endpoint with no event ticked receives only the test message. There is no migration of existing endpoints: they have none ticked.

**It runs in the hourly Cron Trigger** (`15 * * * *`, ADR-029), **before** the delivery, so an episode that came out is delivered in the same run. It adds **one statement**: the 42 subrequests of a full delivery become 43 of the 50. If it fails it is logged by name (`job.failed`, `announce-episodes`) and the delivery of what was already waiting goes on. With `WEBHOOKS_ENABLED` off it does not open the database.

## What is not here, and why

- **New volumes of manga and books.** No data says when a volume comes out (SAG-68 is the ticket for volumes by ISBN). The same statement and event type can take it when there is a source.
- **Notifications for anything but episodes.** The table takes only `episode.aired` (a `CHECK`); a new type is a migration with its text.
- **A time zone and an hour.** See above.

## Alternatives considered

- **Compare the old and the new row in the job of ADR-027.** No new column, but the alert comes a day or more after the episode, because that job asks again the day after it comes out.
- **One message per episode.** Simpler, but a person with many series gets many messages at once, and 20 events a run is all the delivery sends.
- **A table of announcements** (user, title, episode) as the memory of what was told. Exact per person, but it grows with the library; one column on the catalog table says the same for everyone, because the alert depends on the episode and not on the person. The inbox of SAG-102 is a table too, but it is not the memory: it is what the person reads, it is kept 30 days, and the episode is still marked on the catalog table.
- **On by default.** A person who connected a webhook only to try it would find alerts in their channel they never asked for.
- **A Cron Trigger for this.** The Free plan allows 5 and 3 are used; the hourly one has room (43 of 50).

## Consequences

**Good**

- An episode is told once, close to when it comes out, to the people who follow it, in one message each, with nothing in the request path.
- The delivery, the retries, the dead-webhook handling and the log of ADR-029 are reused as they are.

**To watch**

- **Delay.** The cron runs at minute 15 of each hour, so an alert comes up to an hour after the moment TVmaze gives (an episode at 20:16 is told at 21:15), plus up to another hour if TVmaze's answer was cached when the date was read (ADR-027), and more if Discord asks to wait or the delivery is retried (ADR-029).
- **The moment is the one of the television network**, which for a series that is released on a streaming service on another schedule or in another region can differ from when a person can watch it. This was not checked against real series.
- **Only "in progress".** A person who is watching something but has it as "planned" is told nothing.
- **A stop longer than 3 days** (the webhooks switched off, a failing cron) loses the episodes that came out in it: they are never told.
- **Not measured:** the 43 subrequests and the CPU of the run in the real runtime (the 42 of the delivery were not measured either, ADR-029), the time of the statement on a real library, and a real message of this kind in a Discord channel. The statement has no index on `air_stamp`: the table has one row per series with a TVmaze id, and the owner read 9 rows in production on 2026-11-02 (ADR-027), so it is small today; if the catalog grows to thousands of series, look at it again. Look for `episodes.announced`, `webhooks.batch` and `job.failed` in the logs.
- **Migration `0018` must be applied before the code is deployed.** If it is not, the statement fails, the failure is logged, and the delivery goes on, but no episode is told.

## Facts that were checked

The behaviour was checked with tests against a real Postgres (once and only once, even with three runs at the same time; the window; who hears it; the digest and its limit; the language and the title of the person; a later episode of a show already told) and by breaking the statement on purpose in six ways (not marking, ignoring the status, the window, whether the endpoint is on, the event it asked for, and episodes still to come), each of which a test caught. No new fact about a third party was read for this decision: the limits of Discord (2000 characters, mentions) are those of ADR-029 (read 2026-11-02), and the data of TVmaze is that of ADR-027 (read 2026-10-31).

**Not verified:** how close TVmaze's `airstamp` is to when an episode is out for a person (see above), a real delivery of this message, and the number of subrequests and CPU of the hourly run with real events.
