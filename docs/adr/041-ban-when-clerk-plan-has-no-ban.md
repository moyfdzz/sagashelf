# ADR-041: A ban carries on when Clerk's plan has no ban

- **Status:** Accepted
- **Date:** 2026-11-06
- **Implementation:** Done (SAG-153), not tried in production yet
- **Tickets:** SAG-153
- **Related:** [ADR-040](040-warn-suspend-ban.md) (this changes only the part of it about Clerk's ban)

## Context

ADR-040 said a ban goes first to Clerk (`banUser`) and, if Clerk refuses, nothing changes here. The owner tried the first ban in production on 2026-11-06 and Clerk answered `402 unsupported_subscription_plan_features`: the plan of the Clerk instance does not include the ban. With that rule, no account could be banned at all.

Since SAG-148 (ADR-040) the app does not depend on Clerk for this. `findUser` reads `users.moderation_status` on every request, and a suspended or banned person is sent to `/account-restricted` by everything that needs a session. A suspension already asks nothing of Clerk. Clerk's ban only added a second barrier, at sign-in.

## Decision

When Clerk answers a ban or an unban with exactly the status 402 and the error code `unsupported_subscription_plan_features`, the change carries on here: the ban (or the lift) is saved, the reports are resolved and the audit row is written, as when Clerk accepts.

The panel then says that Clerk did not apply it because of its plan (the notices `banned_no_clerk` and `lifted_no_clerk`), so the administrator knows the block is the app's alone. The refusal is not logged as an error.

Only that status and that code are let through, and only for the ban and the unban. Any other refusal, such as a 403, a 500 or a 402 with another code, still stops the change as before, and so does a refusal when releasing an old lock (`getUser` or `unlockUser`).

## Alternatives considered

- **Pay for a Clerk plan that includes the ban.** It costs money and adds nothing the app does not already do. It can be done later without code changes: Clerk then accepts the call and the normal notice is shown.
- **Never call Clerk's ban.** Simpler, but a plan that does include the ban would lose its second barrier for no reason.
- **Let every refusal through.** Hides real problems, such as a wrong key or an outage, behind a ban that looks complete.

## Consequences

- A banned person can still sign in at Clerk with the plan as it is. The app sends them to the page that says the account is restricted, and they can use nothing. Their session in Clerk and their account are not removed.
- Lifting a ban while the plan has no ban changes nothing in Clerk, and that is correct: nothing was banned there.
- If the owner changes plan later, an account banned before the change is not banned in Clerk. Lifting it works either way.

## Open questions

- Whether Clerk's ban should be applied again to the accounts banned meanwhile, if the plan changes. Nothing needs it today, since the app blocks them.

## References

- The error text and status came from the panel in production, read by the owner on 2026-11-06. Which Clerk plan includes the ban was **not** checked.
