# ADR-039: The moderation panel, and a hidden picture that stays hidden

- **Status:** Accepted
- **Date:** 2026-11-06
- **Implementation:** Partial: the panel with dismiss, restore and remove is done (SAG-143, first PR); warn, suspend and ban are planned (SAG-143, second PR)
- **Tickets:** SAG-143, SAG-145, SAG-142, SAG-141
- **Related:** [ADR-038](038-reports-and-picture-records.md), [ADR-037](037-profile-pictures.md), [ADR-033](033-design-rules.md)

## Context

Reports reached the administrator as notifications (ADR-038), and a picture reported for minors was hidden, but nothing let anybody answer. Reviewing meant the Clerk dashboard and SQL. Worse, the hiding only cleared `users.avatar_url`, and the next `user.updated` from Clerk wrote the address back, so a hidden picture came back by itself.

## Decision

**A hidden picture is remembered.** `users.hidden_avatar_url` keeps the address of a picture that was hidden. The sync of Clerk's events (`clerk-sync.ts`) and `applyAvatar` write `avatar_url` as empty while the incoming address equals the hidden one. A different address is a new picture and is shown, and the old address stays recorded until an administrator answers. This is the decision of the owner (2026-11-06): hide the reported picture, not the person's right to have another. Erasing the account clears the column.

**The panel is `/admin/moderation`,** next to the sagas, for an administrator with the usual checks (`readAdminWrite` for each action, a limit keyed by the administrator). It lists the open reports, the minors ones first, with the category, the reason, what the reporter wrote and who is reported, and never who reported. A second list shows the upload tries that Sightengine refused, and the ones it allowed with a score of 0.3 or more. The file is never kept, so that list says who tried, the answer, the highest score and when. The 0.3 was not measured with real pictures, like the limit of 0.5 (ADR-037).

**What the reviewer sees.** A picture reported for minors is not sent to the browser unless the reviewer asks for that one report (`?view=<id>`). Any other picture is shown, drawn with no referrer, and only from an https address.

**Actions.** Each one is one statement that changes the reports and writes an `audit_log` row together, with the administrator of the session and never an id from the form:

- **Dismiss** says no problem was found. It is refused for a report whose picture is hidden, since the picture would stay hidden with nobody looking.
- **Restore** shows a hidden picture again, forgets the hidden address and closes every open report about that picture. It only writes the address back while the person has no other picture, so a newer one is never replaced.
- **Remove** deletes the picture in Clerk, so it cannot come back with a later event, then stores what Clerk answered (the generated image) and resolves the reports. It asks to be confirmed first in a modal (`ConfirmDialog`, SAG-125, opened with `?confirm=<id>`), which also works without JavaScript and has a neutral background with only the confirm button in red. It is refused when the person has replaced the picture since the report, because that picture is theirs and the report says nothing about it.

If Clerk refuses, nothing changes here and the page says so. If Clerk deleted the picture and the local write fails, the `user.updated` that Clerk sends writes the generated image, and the reports stay open to be dismissed.

**Audit rows** carry the kind and the reason, or the id of the report and how many reports were closed, and never an address or a username.

## Alternatives considered

- **Keeping a picture hidden for good until an administrator decides, whatever comes later.** It would also hide an innocent new picture and would punish the person for the first one. Rejected.
- **A new `report_status` value for "hidden".** Migrations run in one transaction and PostgreSQL does not let an index use a value added in the same one (ADR-038). The hidden state is the column.
- **Showing every picture blurred.** It needs JavaScript or CSS tricks and the address would still be in the page. Not sending the address is simpler and stricter.
- **A box inside the card for the confirmation, in red.** It was the first version (SAG-143). The owner found it clumsy: it reloaded the page and the red background was too much. SAG-145 replaced it with the modal of SAG-125.
- **Doing warn, suspend and ban in the same PR.** It adds a second Clerk call, a new state of the account and a notification, and the hole of the hidden picture was the urgent part. They go in the second PR.

## Consequences

- A hidden picture no longer comes back with a `user.updated`, and restoring one no longer needs SQL.
- The reviewer sees a picture reported for sexual content that is not about minors without asking. That is a choice of this PR and can be tightened.
- The export does not carry the hidden address, as it does not carry the reports about the person: it is moderation state, not something the person gave.
- A report of a person (not a picture) can only be dismissed for now. Warn, suspend and ban come in the second PR.
- `reports.status` is `dismissed` or `resolved`, and the audit log says which action did it.
- Applying the migration is a step by hand before the code is used (an added nullable column, so no snapshot is needed).

## Open questions

- Whether 0.3 is a useful "close to the limit". It needs real answers from the service.
- Google's Content Safety API (SAG-141): the owner was reminded to apply when this panel was built.
