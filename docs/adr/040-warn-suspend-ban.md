# ADR-040: Warning, suspending and banning an account

- **Status:** Accepted
- **Date:** 2026-11-06
- **Implementation:** Done (SAG-143, second PR), not tried in production yet
- **Tickets:** SAG-143, SAG-145, SAG-146, SAG-148
- **Related:** [ADR-039](039-moderation-panel.md), [ADR-038](038-reports-and-picture-records.md), [ADR-031](031-social-graph.md), [ADR-007](007-background-work-cron-and-outbox.md)

## Context

The panel of ADR-039 could dismiss a report and act on a picture, but a report of a person could only be dismissed. The ticket (SAG-143) also asked for warning, suspending and banning, each with an `audit_log` entry. The owner chose on 2026-11-06 to follow the recommendations below.

## Decision

**Who can be acted on.** Anyone but an administrator and the administrator who is asking. The data functions check it in SQL, and the page does not offer the buttons.

**Warning** is a notification, not an email (the app sends none). The administrator picks a reason from the list of the kind of the report (the same reasons as the report form, never free text), starting on the reason of the report. The person gets a row of `notifications` of the type `moderation.warning` with exactly the kind and the reason, so it says nothing of who reported, which report or which picture. The page of notifications draws a fixed text in the language of the person, with the reason and a link to the community rules. A warning resolves its report. It is refused while the reported picture is hidden: that one is restored or removed first, or the picture would stay hidden with no open report. The type needed a new value in `notifications_type_check`.

**The app enforces the state, not Clerk (SAG-148).** `findUser` in `server/auth/require.ts` reads `users.moderation_status` on every request. A suspended or banned person is refused by everything that needs a session (`requireUser` and `requireRole` redirect to `/account-restricted`, as a new document) and is a visitor for the public pages that look at who is signed in (`getOptionalUser`). It does not depend on the session that Clerk already issued, so a person who is signed in loses access on the next request, and it does not depend on how long Clerk keeps a lock. The page `/account-restricted` is the same for every account (nothing about why or who), gives the contact address of the community rules and a button to sign out. A restricted person cannot export or delete their account from the app, since those routes need a session: deleting would free the username and the email, which is a way around a ban. They write to the contact address.

**Suspending** keeps `users.moderation_status = 'suspended'` and asks nothing of Clerk. It has **no timer**: it lasts until an administrator lifts it from the list of restricted accounts. The first version (SAG-143) also locked the account in Clerk (`lockUser`) and said that this had no timer. That was wrong: the type definitions of Clerk say a lock lasts "until the lock expires or is manually unlocked. By default, lockout duration is 1 hour", it does not end the sessions that are open, and the sign-in page shows "try again in 59 minutes", which explains nothing. The owner found it trying the panel in production. The lock was dropped. A timer for a suspension can be added later with a job of its own, and the crons are full: of the 50 subrequests, the first uses 49, the second up to 24 and the third 43 (`docs/agent-notes.md`). The profile stays visible.

**Banning** bans the account in Clerk (`banUser`, which does not expire) and keeps `moderation_status = 'banned'`; the app refuses it from the next request, as with a suspension. Banning an account that is suspended releases a lock of Clerk first if it has one (an earlier version made them), so lifting the ban leaves nothing locked. The profile stops being seen: the level of the profile is put at `private`, and the level it had is kept in `users.privacy_before_ban` to be given back when the ban is lifted. This reuses the one policy of ADR-031 (`private` means nobody sees it, not even that it exists), so every screen that shows a person hides it without touching dozens of queries. The account is not erased: its row, username and canonical email stay reserved, so the same email cannot create another account here.

**Lifting** unbans a banned account in Clerk, releases a lock of Clerk on a suspended one if it has one (it asks Clerk first, so it does not fail on an account that is not locked), and gives the account back, and the profile its level. A level the person changed after a suspension is not overwritten, since a suspension never touched it.

**Order.** Clerk goes first, then one statement here that changes the account, resolves the reports and writes the audit row. If Clerk refuses, nothing changes here. If the write here fails after Clerk did, asking again repeats Clerk's call, which changes nothing, and writes.

**Reports.** Suspending or banning resolves every open report about the person, except one about a picture that is hidden: it stays open to be restored or removed, or the picture would stay hidden after a lift.

**Audit.** `account.warned`, `account.suspended`, `account.banned` and `account.lifted`, with the ids and the reasons and never a name or an address.

**Not exported.** The export does not carry the moderation state, as it does not carry the reports about the person. The erasure clears `privacy_before_ban`.

**Direct actions (SAG-146).** An administrator can also warn, suspend, ban and lift **with no report**, from the box "Act on a person" of the panel: they type a username and get the card of that person. The server finds the person by username (a private profile too, since the panel is for an administrator) and uses the same rules and the same statements as for a report: nothing is done to an administrator or to oneself, an erased account does not exist, and a warning takes a reason of the list for a person. The form never carries the id of the person. The data functions take a report or a person (`Subject`) and share the one query that decides who can be acted on (`subjectRows`), so the rule is written once. A direct warning can be repeated, since no report is closed by it. The audit row says `direct` and carries an optional internal note of up to 200 characters, which the person never sees. Suspending or banning also resolves the open reports about the person, as before. No migration was needed.

## Alternatives considered

- **Free text in the warning.** More control for the administrator, but a way to leak who reported, and a piece of writing for each warning. Rejected for now.
- **A suspension with an end date.** Needs a job and a subrequest. Rejected until it hurts.
- **Hiding a banned account in every query** (`moderation_status <> 'banned'`). Many queries to change and easy to forget one. The privacy level is the one place that already decides this.
- **Buttons on the profile of the person** for an administrator. The profile is a public page (`private, no-store`, not a session page) and `u.$username.tsx` is near the limit of 600 lines. A link "Moderate" that opens the card in the panel can come later, in its own ticket.
- **Erasing a banned account.** It frees the username and the email, which is the opposite of a ban.

## Consequences

- A banned person who deletes the account from the Clerk dashboard is erased as any other, which frees their username and email. Nothing here stops that.
- The page "Reglas de la comunidad" already says that accounts can be suspended or erased and gives a contact email, which is also how a person can ask for a review. There is no appeal form.
- The sessions of a restricted person stay valid in Clerk, and the app ignores them: every request asks our table. Clerk's own pages (sign-in, the user menu) still work for them, which is how they sign out.
- If the administrator changes an account in the Clerk dashboard, the state here does not follow, since the sync of events does not read it.
- The migration 0027 adds two columns and a level to `users` and a value to the check of `notifications`; it changes no data.

## Open questions

- Whether a warning needs a counter (a second warning could suggest a suspension). Not built.
- Whether the banned profile of someone with followers should keep counting in their followers' lists. It follows what a Total privacy profile does today.

## References

- `@clerk/backend` (the version in `package.json`), `UserApi`: `banUser`, `unbanUser`, `lockUser` and `unlockUser`, each taking the user id. The comment of `lockUser` says: "they are not allowed to sign in again until the lock expires or is manually unlocked. By default, lockout duration is 1 hour". Read from the type definitions on 2026-11-06.
