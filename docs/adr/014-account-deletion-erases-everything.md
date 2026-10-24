# ADR-014: Deleting an account erases it completely

- **Status:** Accepted (supersedes the deletion rule of [ADR-003](003-auth-clerk.md), point 6 of "The webhook")
- **Date:** 2026-10-24
- **Implementation:** Done for the profile and for every table that holds what a person makes or follows (SAG-12). The tables that SAG-18 adds must be added to the erasure.
- **Tickets:** SAG-12, SAG-18, SAG-22
- **Related:** [ADR-003](003-auth-clerk.md)

## Context

ADR-003 kept a deleted account as a row with the display name, avatar and bio cleared, and with the username, the Clerk id and the canonical email still reserved, so nobody could take them and one inbox could not make many accounts. The acceptance criterion of SAG-12 is the opposite: a deleted account leaves no personal data in our database. A username and an email address are personal data, and a person who deletes their account expects to be able to come back with the same address.

The cost of freeing them is small today: there is no moderation yet, so there is no one to ban and no ban to evade.

## Decision

- **A button in the settings** deletes the account. It asks for the username typed by the person and for a box that says it cannot be undone, and it needs a recent sign-in (`has({ reverification: "strict" })`: the first factor within 10 minutes). With an older session the person is asked to sign in again. There is no grace period: the account is erased at once.
- **Clerk is asked first** (`users.deleteUser`). If Clerk refuses, nothing is erased and the person can try again. Then our data is erased in one SQL statement, so it is erased whole or not at all. If that step fails after Clerk deleted the account, Clerk's `user.deleted` event runs the same erasure a moment later (Svix retries).
- **What is erased** (`server/db/erase-user.ts`): everything the person made or follows (`library_entries`, `custom_entries` and the titles they wrote, `lists` with their items, `follows` in both directions, `blocks` in both directions, `activity`, `likes`, `webhook_endpoints`), the profile (display name, avatar, bio) and the privacy level (back to private). The **username becomes `deleted-<12 hex characters of the id>` and the canonical email becomes `deleted:<id>`**, so both can be used again.
- **What stays** is the row with its id, its Clerk id, its role and `deleted_at`, and nothing that says who the person was. The Clerk id stays so that a late `user.updated` or `user.created` of the same account cannot bring it back (the upsert skips a deleted row), and the id keeps rows that point at the account valid (a report, the audit log).
- **No table can be forgotten.** An integration test reads the foreign keys of the real database and fails when a table that cascades on `users` is not in the list `erasedColumns`. A table added later fails that test until it is handled.
- **The data export** is a direct download (JSON of everything, CSV of the profile) from the settings, with a POST, the `Origin` check and the rate limit. It is not an asynchronous job with an expiring link, because the data is small. Library, custom entries and lists are already in the JSON and stay empty until SAG-18.

## Alternatives considered

- **Keep the names reserved (ADR-003).** It stops a banned person from coming back, but it keeps a username and a normalized email of someone who asked to be erased. Rejected.
- **Keep a hash of the email.** It would still stop re-registration, but a hash of an email is guessable and is still personal data. Not done now. If moderation (SAG-22) needs it, it belongs in a list of blocked addresses for banned accounts only, not for every deleted account.
- **A 30-day grace period.** More software (a job that finishes the deletion) and a period in which the data is still there. Rejected for now.
- **An asynchronous export with a link that expires.** Needs storage and a job. Not worth it for a few rows. To revisit when the library can be large.
- **Clerk's own re-verification window** (a modal that asks for the password again). It loads Clerk's interface on the settings pages, which have a narrow CSP, and would need a wider one (a change that needs its own ticket and test). The check of the age of the sign-in is done on the server with no new script.

## Consequences

- A person can leave, and come back with the same username and email.
- **A banned person can come back too.** Moderation (SAG-22) has to decide how to stop that, for example with a list of blocked addresses that only banned accounts enter.
- The reverification check depends on the session token carrying the time of the last sign-in (Clerk's `fva` claim). It was **not tried with a real session**: if the token does not carry it, `has()` answers false and the button always asks the person to sign in again. The person can then still delete by email (the policy says how). Tried on a preview before relying on it.
- Backups of the database provider may keep a copy of an erased account for a short period. The policy says so.
- `/privacy` now says the rights are used from the settings (SAG-34 text updated).

## Open questions

- Whether the session token of this Clerk instance carries `fva` (see above). It is settled by trying the button on a preview with a real account.
- How moderation stops a banned person from registering again (SAG-22).
- How long the database provider keeps backups, to say it in the policy. Not read yet.

## References

- [ADR-003](003-auth-clerk.md), "The webhook", point 6 (replaced by this record).
- Clerk: `has()` with a `reverification` option, and `users.deleteUser` in `@clerk/backend`. Read in the installed types on 2026-10-24; the behavior of the token was not checked.
