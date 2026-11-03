# ADR-029: Outgoing webhooks to Discord: the outbox, the delivery and the settings page

- **Status:** Accepted
- **Date:** 2026-11-02
- **Implementation:** Done (SAG-27) for the machinery: the outbox, the delivery job, the third Cron Trigger and the settings page, with the test message as the only event that is sent. The events that people will receive are queued by SAG-28 (a new episode, done: [ADR-030](030-new-episode-alerts.md)) and SAG-44 (a finished title). The signed generic webhooks of the ticket are left for a ticket of their own.
- **Tickets:** SAG-27, SAG-28, SAG-44
- **Related:** [ADR-007](007-background-work-cron-and-outbox.md), [ADR-012](012-neon-over-supabase.md), [ADR-018](018-personal-library.md), [ADR-002](002-data-and-migrations.md)

## Context

ADR-007 decided the shape: a transactional outbox, a Cron handler that delivers it, retries with backoff, an endpoint that is turned off when it is dead, and a log of deliveries. The tables existed since SAG-9. SAG-27 builds the rest, for **Discord**: a person pastes the address of a webhook in their settings and gets messages in that channel.

Three things in the ticket did not survive a look at the code and the limits of the free plans, and are decided here:

- The ticket asks for a Cron Trigger **every minute**. The Neon Free plan pauses the compute after 5 minutes without a query and gives 100 compute hours a month, so a query every minute would keep it awake and use the hours up (ADR-012 had already noted that "a database that never sleeps can run out").
- The `outbox` table already holds events that are **not deliveries**: the Clerk webhook queues `clerk.user_rejected` for an account it refused (SAG-11). A delivery job must not read those.
- A webhook belongs to **a channel of a server**, not to a person. Posting to somebody's direct messages needs a bot, which is a different feature.

## Decision

**One outbox row per event and endpoint.** An event for a person is queued as one row for each of their endpoints that is on and asked for its type (`enqueueEventInsert` in `server/db/webhooks.ts`). The key of a row is the id of the event and of the endpoint, so queuing the same event twice queues it once. A dead endpoint therefore holds back no other: each row has its own attempts, its own next try and its own result. `enqueueEventInsert` is a statement and not a call, so the change that causes an event can carry it as a data-modifying CTE next to its own write, which is the transactional outbox of ADR-007; SAG-28 and SAG-44 use it that way.

**Migration `0017`** (additive): `outbox.endpoint_id`, **optional** and with `ON DELETE CASCADE` (so deleting an endpoint or the account takes its waiting events with it, and the events that are not deliveries have none), a partial index for the rows the job reads, `webhook_endpoints.disabled_reason` with a check on the three reasons the page has a text for, a check that an endpoint that is off says when it was turned off, and `UNIQUE (user_id, url)`. `webhook_endpoints` has no rows in production (nothing wrote to it), so its new checks cannot fail on old data; `outbox` may hold `clerk.user_rejected` rows, which the new column leaves as they are because it is optional.

**The delivery job** (`server/jobs/deliver-outbox.ts`):

- It **claims** up to 20 events that are due, for endpoints that are on, in one statement with `FOR UPDATE SKIP LOCKED`, adds one to `attempts` and moves `next_attempt_at` 10 minutes out (the lease). Two runs at once take different events, and a run that dies leaves its events to come back after the lease, not to be sent twice at once.
- For each event it checks the address again (the table only insists on `https`), builds the message, sends it, and records the result **in one statement**: the line of the log, the state of the event, and the count of failures of the endpoint, which it turns off at the fifth in a row. When an endpoint ends up off, its waiting events are given up on in the same statement, and the events of that endpoint that the same run had already taken are not sent.
- One event that cannot be recorded (the person deleted the endpoint while the message was on its way) is counted and never stops the run.
- It budgets the 50 subrequests of an invocation: the claim is 1, each event 2 (the call to Discord and the record) and the clean-up 1, so **20 events are 42 at most**. This was not measured in the real runtime.
- It trims what is older than 30 days (the log, and the events that were delivered or given up on), only in a run that sent something.

**What each answer means** (`server/webhooks/outcome.ts`, a pure function with its own tests):

| Answer                  | What happens                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2xx                     | Delivered. The count of failures goes to zero.                                                                                   |
| 429                     | Wait what Discord asked (at least 1 second, at most 12 hours) and try again. It does not count against the endpoint.             |
| 401, 403                | The token is no good: the endpoint is turned off at once, as `unauthorized`.                                                     |
| 404, 410                | The webhook is gone: turned off at once, as `not_found`. Discord restricts a caller that keeps using a webhook that answers 404. |
| Another 4xx             | Given up on, not retried (the same message would be refused again). It counts as a failure.                                      |
| 3xx                     | Never followed, never retried. It counts as a failure.                                                                           |
| 5xx, no answer, timeout | Retry after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours (spread by 20%), then give up. It counts as a failure.         |

A send gives up after **5 seconds**. When Discord says the limit of a webhook is used up (`X-RateLimit-Remaining: 0`), the other events of that webhook in the same run are given back, without using a try, for when it resets.

**The cadence is hourly, not every minute**: a third Cron Trigger, `15 * * * *`, with an invocation of its own (so its own 50 subrequests). Two things make that acceptable. The **test message is sent at once**, by the request of the person who pressed the button, with the same code and rules as the job, and is never retried (a message that arrives hours later is not a test). And the events that will come later are alerts, which do not need to arrive in the same minute. The waits of the table are therefore the **earliest** a retry can happen: it happens at the next run after the wait. A run with nothing due costs one statement. The string is in `triggers.crons` of `wrangler.jsonc` and in `outboxCron`, and a test keeps them equal and not equal to the other two. Three of the five Cron Triggers of the Free plan are used.

**The address is the only defence against server-side request forgery, and it is strict** (`server/webhooks/discord-url.ts`): `https`, host exactly `discord.com` or `discordapp.com`, no user, no password, no port, no query, no fragment, and a path that is exactly `/api/webhooks/<number>/<token>`. Spaces, control characters and backslashes are refused before the URL parser sees the text, because the parser would turn some of them into something else. What is saved is **rebuilt from the parts that were checked**, never the text that was typed. The same check runs again at the moment of the send, whatever the table holds. A send never follows a redirect (`redirect: "manual"`; a 3xx counts as a failure). The test list has addresses with the host in the user part, in a subdomain, with a trailing dot, in numbers and in hexadecimal, a cloud metadata address, an IPv6 one, a lookalike letter, a dot segment, an encoded slash and a null character.

**The message cannot mention anyone** (`server/webhooks/message.ts`): `allowed_mentions` is `{ parse: [] }` and the text itself is made safe (a zero-width space after every `@`), because a title comes from a provider and a note from a person. It is cut to 2000 characters.

**The address of the webhook is a secret of the person, kept as it is in their row.** Anyone who has it can post in that channel, but not read it or do anything else, and deleting the webhook in Discord ends it. It is kept in plain text because the column was designed so (and the database check insists on `https`); encrypting it would need a key kept as a Workers secret and a migration, which was not worth it for this risk. It is **masked** (host, id and the last four characters of the token) in everything that leaves the server: the page, the log, the export of the account, every message of an error. It is never written in a log, and the summary and the errors the job logs hold counts and a name, never an address or the body of an answer. It goes with the account: the endpoint is in the erasure and the rest cascades from it.

**The settings page** (`/settings/notifications`, a session page, so linked with a plain `<a>` from the settings): save an address (up to **3** per person), the numbered steps to make a webhook, a warning that **whoever can read the channel will see what is posted** (the advice is to make a server of one's own with a channel only for oneself), a test button, the endpoints with their state and, when one was turned off, why and since when, a button to turn it back on (which clears its failures) that is offered **only when it was turned off for failures in a row** (SAG-105: turning it on sends nothing and cannot check that the webhook exists, so for a webhook that Discord says is gone, or whose token it refuses, it would be sent to again, answered the same, and turned off again; there only the button to remove it is shown, and `reenableEndpoint` refuses it too, so a form sent by hand cannot go around the page), a button to remove it, and the latest 20 deliveries. Every write checks the `Origin`, rejects a body over 2 KB, is rate limited by person (`webhooks:<id>`), is a Zod `strictObject`, and has the id of the session in its `WHERE`. A notice of a dead endpoint is the banner on that page: there is no email.

**A switch**, `WEBHOOKS_ENABLED`, a plain variable like the ones of the providers: without it the page says the feature is not available, nothing is saved or sent, and the third trigger does not even open the database. It is unset in CI and in previews.

**What is not here, and why.** The generic signed webhooks (HMAC, a secret shown once, rotation) need a key kept as a Workers secret and were marked optional in the ticket: a ticket of their own. A **bot** that writes to a direct message needs its token as a secret, a sign-in with Discord to know who the person is, a stored Discord id (a new piece of personal data) and the person sharing a server with the bot: a different feature, and the outbox does not change for it (`webhook_kind` is a column, so it would be one more kind with its own send). A view of the log for the administrator waits for the administration dashboard (SAG-26). The `clerk.user_rejected` events stay in the outbox as they were: they have no endpoint, and the job never reads them.

## Alternatives considered

- **One outbox row per event, with the deliveries per endpoint in `webhook_deliveries`.** Closer to how the tables were first drawn, but the state of the event is then one for all its endpoints, and "one dead endpoint must not hold back the others" needs a second state per endpoint. One row per endpoint is simpler and the log table keeps its meaning.
- **A Cron Trigger every minute**, as the ticket says. Rejected for the Neon hours above; if the project moves to a paid Neon plan or a database that does not sleep, the cadence can change by editing one string.
- **Deliver in `waitUntil` right after the request.** It would give near-instant delivery for the events of the future, but a failure there has nowhere to go but the outbox, so the sweep is needed anyway. It can be added by SAG-28 and SAG-44 where it matters.
- **A Cloudflare Queue or Durable Objects.** Not evaluated (as in ADR-007).
- **Encrypt the address.** See above.
- **Follow redirects up to a limit.** A webhook of Discord does not redirect, and a redirect is how an address would lead the Worker somewhere else.

## Consequences

**Good**

- A person can connect a channel, see that it works, and see what was sent; a dead webhook turns itself off, says why, and costs the others nothing.
- Everything that decides is a pure function or one statement with a test against a real Postgres. The tests of the job cover success, a 429 with its wait, a 5xx and the waits, a permanent 4xx, a redirect, an endpoint turned off in the same run as one that works, two runs at once, a run that dies, an address that is not Discord's, and a message that mentions nobody.
- SAG-28 and SAG-44 only have to write the text of their event and carry `enqueueEventInsert` in their statement.

**To watch**

- **Nothing real has been sent to Discord.** Every test uses a fake `fetch` or the mock server; the first real message is the one the owner sends from production with the test button. The behaviour of `redirect: "manual"` was checked under Node, **not in the Workers runtime**.
- **The 42 subrequests of a full run and its CPU time were not measured** in the real runtime (the first runs of the other crons were the first measure of those, and showed no failure). Look for `job.failed` and for `webhooks.batch` in the logs.
- **Delivery of anything but the test is up to an hour late.** That is the price of letting the database sleep.
- **The hours of compute** were not computed: the size of the compute that the project uses on Neon was not looked up, so the hourly choice is conservative, not measured. If the hours run short, look at the number of wake-ups of all the triggers together.
- **The limit of 3 endpoints is checked in the same statement as the insert but is not a lock**: two forms sent at the same time can leave a person with 4. It is there to keep one person from filling the table, not to be exact.
- **An address kept in plain text** is as safe as the database. A leak of it lets someone post in those channels until the person deletes the webhooks in Discord.

## Facts that were checked

Read on **2026-11-02**:

- **Discord, Execute Webhook** (<https://docs.discord.com/developers/resources/webhook>): `POST /webhooks/{webhook.id}/{webhook.token}`; `content` up to 2000 characters; up to 10 embeds; an `allowed_mentions` field; the answer is `204 No Content` without `wait` (the page says "a message or 204 No Content depending on `wait`", and `wait` defaults to false); and the advice to sanitize the data and to use `allowed_mentions`.
- **Discord, rate limits** (<https://docs.discord.com/developers/topics/rate-limits>): a 429 has a JSON body with `message`, `retry_after` (a float, **in seconds**) and `global`, and the page tells the application to rely on the `Retry-After` header or the `retry_after` field; the headers `X-RateLimit-Limit`, `-Remaining`, `-Reset`, `-Reset-After` (seconds), `-Bucket`, `-Global` and `-Scope`; webhooks are a top-level resource of the limits; "if a webhook returns a **404** status you should not attempt to use it again - repeated attempts to do so will result in a temporary restriction"; and a limit of 10,000 invalid requests (401, 403 or 429) per 10 minutes. No number is given for the limit of one webhook.
- **Discord, error codes** (<https://docs.discord.com/developers/topics/opcodes-and-status-codes>): `10015 Unknown webhook` and `50027 Invalid webhook token provided`.
- **Neon Free plan** (<https://neon.com/docs/introduction/plans>, <https://neon.com/faqs/free-plan-limits-and-quotas>, as found by a search): 100 CU-hours per project per month, the compute pauses after 5 minutes without activity and that cannot be turned off, a paused compute does not use hours, and when the hours run out the compute is suspended until the next period. ADR-012 had read the same on 2026-10-21.
- **Cloudflare Workers Free plan**: 50 subrequests per invocation and 5 Cron Triggers per account (ADR-001, ADR-007).

**Not verified:** the hosts of a Discord webhook (the two in this ADR come from the ticket; the pages that were read do not list hosts); whether `Retry-After` is in seconds (the page shows `Retry-After: 65` next to `retry_after: 64.57`, which suggests so but does not say it); what an empty `parse` list does exactly (the page only says the field exists), though it is the usual way to mention nobody; the HTTP status that goes with the codes 10015 and 50027 (the pages do not pair them, so 401, 403, 404 and 410 are all treated as a dead webhook); the total size limit of an embed (no embed is sent); and, as said above, a real delivery.
