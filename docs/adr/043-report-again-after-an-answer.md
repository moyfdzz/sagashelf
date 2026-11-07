# ADR-043: A person can report the same thing again after an answer

- **Status:** Accepted
- **Date:** 2026-11-06
- **Implementation:** Done (SAG-147), migration 0028 applied in production on 2026-11-06
- **Tickets:** SAG-147
- **Related:** [ADR-038](038-reports-and-picture-records.md) (this changes only the part about who can report again), [ADR-040](040-warn-suspend-ban.md)

## Context

ADR-038 let a person report the same user, or the same picture, once. The unique index of `reports` only freed the slot when the reporter cancelled the report while it was open. A report that an administrator answered (resolved or dismissed) is closed but not cancelled, so the reporter saw "You already reported this user" for ever. If the person kept misbehaving after a warning, the same reporter could not report again. The owner found it on 2026-11-06 trying the moderation panel. It was a side effect of ADR-038, not a decision.

## Decision

A person has **one open report** about the same thing. The unique index `reports_reporter_target_active_unique` now counts only the rows that are not cancelled and whose status is `open` or `reviewing`. A report that is cancelled, resolved or dismissed frees the slot, and the person can report again. Each picture is still apart from the person and from other pictures.

`findMyReports` looks at the same rows, so the profile button and the report page show "You already reported" only while the report is open or being reviewed. After an answer the form is shown again.

An answered report is kept as it was: the record of what was said does not change, and a new report is a new row.

**`createReport` names no index.** It uses `ON CONFLICT DO NOTHING` with no target. Migrations are applied by hand (ADR-002), so there is a moment when the code and the index do not match. A target that names the condition of one index fails against the other ("there is no unique or exclusion constraint matching the ON CONFLICT specification") and nobody could report. With no target it works with the old index and with the new one, so the order is: merge, then apply migration 0028. Before the migration it behaves as before; after it, the answered report frees the slot. A test drops the new index, creates the old one and checks that.

**The limit of 20 reports a day per person stays**, so repeating is limited. There is **no waiting time** after a dismissed report.

## Alternatives considered

- **A waiting time after a dismissal (for example 7 days).** It would slow somebody who reports the same thing to annoy, but it needs a rule for what counts as the same thing and a message for the reporter. Not needed yet, since the limit of the day exists and each report reaches the administrator, who is the owner.
- **Name the new condition in `ON CONFLICT`.** It matches the ticket's first idea, but it breaks reporting between the deploy and the migration, whichever goes first.
- **Free the slot only for a dismissed report.** A resolved one also ends the matter: the person was warned, suspended or banned, or the picture was dealt with, and a later problem is a new one.

## Consequences

- A reporter can send the same report once for each answer. One person could fill the panel with the same report if every one is dismissed; the 20 a day cap and the owner's eyes are the only brakes. If it happens, add a waiting time.
- `ON CONFLICT DO NOTHING` with no target also ignores any other unique clash in `reports`. Today there is none besides the primary key, a random id. A new unique constraint on that table must be thought through against this statement.
- A report of minors that was resolved can be repeated too, but the picture is hidden by then, so there is no picture to report.

## Open questions

- Whether a dismissed report needs a waiting time before the same person can report the same thing again. Decided on 2026-11-06 to leave it out; to be seen if it is abused.

## References

- PostgreSQL, `INSERT ... ON CONFLICT`: with no conflict target, `DO NOTHING` skips a row on any unique violation. This is the author's knowledge of the documentation, not read again on a date; the behavior was checked by the integration tests on Postgres 18.
