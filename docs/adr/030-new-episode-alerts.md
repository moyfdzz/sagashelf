# ADR-030: Alerts of new episodes, through the outbox to Discord

- **Status:** Accepted
- **Date:** 2026-11-03
- **Implementation:** Done (SAG-28) for the episodes of series and anime, delivered to Discord. New volumes of manga and books, a notification inside the app, and "do not tell me about this series" are left out (see "What is not here").
- **Tickets:** SAG-28, SAG-27, SAG-90
- **Related:** [ADR-007](007-background-work-cron-and-outbox.md), [ADR-018](018-personal-library.md), [ADR-027](027-tvmaze-next-episode.md), [ADR-029](029-discord-webhooks.md), [ADR-012](012-neon-over-supabase.md)

## Context

ADR-027 keeps the next episode of each series (`media_next_episode`) and ADR-029 built the outbox and the delivery to Discord, with the test message as the only event. SAG-28 is the first real event: tell a person that an episode of what they are watching has come out.

Four things in the ticket did not match what exists, and are decided here:

- **The table keeps one row per title, the next episode, and overwrites it.** The job of ADR-027 asks TVmaze again the day after an episode comes out, and saves the episode that follows. Comparing "before" and "after" in that job would tell people about an episode more than a day after it came out.
- **There is data for episodes only.** Nothing in the database says when a new volume of a manga or a book comes out (that is SAG-68), and there is no table of notifications inside the app.
- **Nobody receives anything today.** `webhook_endpoints.event_types` is empty by default and the settings page had no way to choose.
- **There is no time zone per person**, only the language (`users.locale`).

## Decision

**An episode is told when its moment has passed, not when the row changes.** One new nullable column, `media_next_episode.announced_stamp` (migration `0018`, additive), holds the `air_stamp` of the last episode that was told for that title. A statement (`announceNewEpisodes` in `server/db/episode-alerts.ts`) takes the rows whose `air_stamp` has passed, is not older than 3 days, and is newer than `announced_stamp`; sets `announced_stamp` to the stamp; and queues the messages, **all in one statement** (data-modifying CTEs, the pattern of ADR-029). A statement is the only atomic unit on the HTTP client of the Worker, so an episode is marked and queued together or neither. Two runs at the same time cannot both tell it: the second waits for the row and then finds it marked (tested with three runs at once). The marker is a moment and not a season and number, so an episode with neither still works.

**The window of 3 days** keeps the first run after the alerts are switched on, or after a long stop, from telling news that is days old. An episode that came out longer ago is not told, and nothing is queued for it.

**Who hears it:** a person who has the title in their library as **"in progress"** (`library_entries.status`) and has an endpoint that is on and asked for `episode.aired`. An episode nobody follows is still marked, so someone who starts the series later is not told old news.

**One message per endpoint, a digest.** All the episodes of the moment for that endpoint go in one `episode.aired` event: the first 10 titles (in order of title) and how many there were, so a Sunday night with eight series is one message. The title is in the language of the person (`titles ->> locale`, else the title saved). The key of the event is made from what it tells (the endpoint and a hash of the titles and moments), so even a repeat of the same statement could not queue it twice.

**The text** (`server/webhooks/message.ts`) is "a new episode is out" or "N new episodes are out", then one line per title with season and episode when TVmaze gave them, and "… and N more". It carries **no hour**: TVmaze's date is in the time zone of the network (ADR-027), and the person's own zone is not known, so naming an hour would often be wrong. It mentions nobody (ADR-029). A payload that says nothing is given up on, not sent.

**It is opt-in, per endpoint.** The settings page has one box for each webhook, "New episodes of what you are watching", off until the person ticks it, saved with its own button (`setEndpointEvents`; a Zod `strictObject`, the `Origin` check, the rate limit and the id of the session in the `WHERE`, like the other actions). An endpoint with no event ticked receives only the test message. There is no migration of existing endpoints: they have none ticked.

**It runs in the hourly Cron Trigger** (`15 * * * *`, ADR-029), **before** the delivery, so an episode that came out is delivered in the same run. It adds **one statement**: the 42 subrequests of a full delivery become 43 of the 50. If it fails it is logged by name (`job.failed`, `announce-episodes`) and the delivery of what was already waiting goes on. With `WEBHOOKS_ENABLED` off it does not open the database.

## What is not here, and why

- **New volumes of manga and books.** No data says when a volume comes out (SAG-68 is the ticket for volumes by ISBN). The same statement and event type can take it when there is a source.
- **A notification inside the app.** There is no table, no page and no erasure or export for it; that is a feature of its own. Today the only destination is a Discord channel.
- **"Do not tell me about this series".** It needs a column on the library and a control on its page. For now a person controls it by the status they give the title ("in progress") and by the box of the webhook.
- **A time zone and an hour.** See above.

## Alternatives considered

- **Compare the old and the new row in the job of ADR-027.** No new column, but the alert comes a day or more after the episode, because that job asks again the day after it comes out.
- **One message per episode.** Simpler, but a person with many series gets many messages at once, and 20 events a run is all the delivery sends.
- **A table of announcements** (user, title, episode). Exact per person, but it grows with the library and needs erasure and export; one column on the catalog table says the same for everyone, because the alert depends on the episode and not on the person.
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
