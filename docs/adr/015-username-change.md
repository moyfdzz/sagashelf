# ADR-015: Changing the username

- **Status:** Accepted
- **Date:** 2026-10-24
- **Implementation:** Done (SAG-37).
- **Tickets:** SAG-37, SAG-22
- **Related:** [ADR-003](003-auth-clerk.md), [ADR-014](014-account-deletion-erases-everything.md)

## Context

The username lives in Clerk, where it is required at sign-up, and the webhook mirrors it in `users.username` (a `citext` column, so "Ana" and "ana" are the same name). The settings page showed it as read-only. A person should be able to change it, but a name is how others recognize them, so it cannot change without limit.

## Decision

- **One change every 30 days** per person. The date of the last change is `users.username_changed_at` (null until the first change). The server checks it; the form only explains it.
- **The change is taken before Clerk is asked**, with one SQL statement that checks the date and sets it. Two requests sent together cannot both pass (an integration test sends eight at once). If Clerk refuses, the old date is put back so the person can try again.
- **Clerk is the source of truth.** The route calls `users.updateUser`. When Clerk accepts, our row is written at once with the time Clerk gave to the change as `clerk_updated_at`. The `user.updated` event that follows carries the same time, so the webhook finds nothing newer to apply, and a late or repeated event cannot undo the change. If our write fails, that event writes the name instead.
- **Rules.** Zod (`server/account/username-schema.ts`): 3 to 30 characters, ASCII letters, digits and underscore only, not numbers alone, not in `reservedUsernames`. A name taken by another account (a deleted account's row included, which holds `deleted-...`, not the old name), a reserved name and a name Clerk refuses all get the **same answer, "unavailable"**, with the same status, so the answer does not say which one it was. The name the person already has is not a change and does not use up the 30 days.
- **The old username is not reserved.** It is free as soon as the change is done, and anyone may take it. The same is said in the settings: next to the field, and in the deletion section (where a deleted account frees its name, ADR-014).
- The route is a POST with the `Origin` check, a 1 KB body limit and the write limiter per person. The date is cleared when an account is erased.

## Alternatives considered

- **Reserve the old name for 30 days.** It makes it harder to impersonate someone just after they change, but it needs a table that is cleaned up with the account, and today there are few people and no moderation to enforce it. Not done now. To revisit with SAG-22.
- **Write our row only from the webhook.** The page would show the old name until the event arrives, and a late event would make the two sources disagree for a while. Writing at once with Clerk's time avoids both.
- **Take the date after Clerk accepts.** Two requests sent together could both reach Clerk. Taking it first, and giving it back on failure, closes that.

## Consequences

- Someone can take a name another person just left. The risk is low while the app is small; moderation (SAG-22) decides whether to reserve names.
- Clerk's own rules for a username may be stricter than ours (the set of characters allowed in the Clerk instance was not read). A name Clerk refuses is shown as "unavailable".
- `users.username_changed_at` is a stored date. It is cleared when the account is erased. The data export does not include it: it is an internal control, not content of the person. `/privacy` needs no new text.

## Open questions

- Whether to reserve old names for a time (see above), with SAG-22.
- Which characters Clerk allows in this instance. The errors from Clerk are logged by name only, never with the value.
