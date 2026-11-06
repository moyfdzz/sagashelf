# ADR-038: Reports of a picture or a person, and a record of picture uploads

- **Status:** Accepted
- **Date:** 2026-11-05
- **Implementation:** Done (SAG-142), not tried in production yet
- **Tickets:** SAG-142, SAG-143, SAG-141
- **Amended by:** [ADR-043](043-report-again-after-an-answer.md) (the same person can report again once the earlier report was answered)
- **Related:** [ADR-037](037-profile-pictures.md), [ADR-014](014-account-deletion-erases-everything.md), [ADR-031](031-social-graph.md)

## Context

People can upload a profile picture (ADR-037), and the automatic check makes mistakes. Nobody could report a picture, and nothing kept who uploaded what. The owner read OpenAI's guide on child safety for developers and decided on 2026-11-05 to keep uploads on, without legal advice for now, and to add clear rules, reports and records. A page to review reports comes later (SAG-143).

## Decision

**Rules.** The community rules forbid any sexual content and say that content that sexualizes minors is not tolerated, including drawings, anime and AI images.

**What can be reported.** From a profile, with a session, a person can report the picture or the person, each with a category and a reason. The categories are in `server/account/report-schema.ts`. The reason is required only for "Other". A person can report whoever's card they may see, and never themselves. Anything else answers the same 404 as a profile that does not exist. The address of the picture comes from the server, never from the form.

**What the reporter can do afterwards.** The link becomes "You already reported this picture" or "...this user", which only the reporter sees. A report of a picture belongs to that picture, so a new picture can be reported. A report can be cancelled while its status is `open`. It is marked with `cancelled_at` and never deleted, and the person can report again. A report cannot be edited: it records what was said, and cancelling and sending another corrects it.

**A report of minors.** "Sexual content with minors" clears `users.avatar_url` at once, so the picture stops showing everywhere, and it stays in Clerk. It cannot be cancelled, and the form warns of both before it is sent. Only the person's current picture is hidden, if it is the one reported.

**One statement.** `createReport` records the report, hides the picture and alerts the administrators in one statement with CTEs, so a report is never recorded without the rest. The limit of 20 a day is in it too, so requests sent together cannot pass it, and it limits how many pictures one account can hide.

**The alert.** Each administrator gets a row of `notifications` with the kind, the reason and the username, never the image or the reporter. It counts in the number of the header, so a report is seen without a page of its own.

**Records of uploads.** `picture_uploads` has one row for each try that reached the moderation service: the account, the time, the SHA-256 of the file, the answer, the scores and the IP address. The image is not kept. If the row cannot be written, the picture is not published.

**They outlive the account for a while.** The rows are deleted after 90 days by the job of the second Cron Trigger, also for an erased account, so that deleting an account does not erase the trace of what it tried to publish. This is the exception to ADR-014, and the privacy policy says so. The job goes in the second trigger because it always runs, and the hourly one does not when the webhooks are off. It costs one subrequest more.

**Reports outlive both accounts,** as they did, including the address of a reported picture. That address is not cleared on erasure: two reports of one person with different pictures would then collide on the unique index and stop the erasure.

**The export** carries the reports the person made and their records. It never carries the reports about them, which would say who reported.

**The state of a report is a date, not a new value of `report_status`.** Migrations run in one transaction, and PostgreSQL does not let an index use a value added to an enum in the same transaction.

## Alternatives considered

- **Editing a report.** Simple for the reporter, and what the administrator read would change under them. Rejected.
- **No cancelling at all.** One state less, and a mistake could not be taken back. Rejected, except for minors: there, somebody could report and take it back under pressure.
- **Letting a cancelled report of minors bring the picture back.** It would let one account hide and show a picture at will. A picture stays hidden until somebody reviews it.
- **Waiting for several reports before hiding.** Harder to abuse, and an illegal picture would stay public, with few people around to report it. Rejected: an account can hide at most 20 a day.
- **Keeping the record in `audit_log`.** It has no deletion and is for actions of administrators.
- **Showing the picture in the alert.** The guide asks to limit exposure to harmful material, so it does not.

## Consequences

- A person can report anything they see, and the administrator finds out in the app.
- **An account can hide somebody's picture with one false report,** up to 20 a day. Few people use the site, and reviewing is by hand until SAG-143.
- **Until SAG-143, reviewing means the Clerk dashboard and SQL.** A hidden picture comes back with a later `user.updated` of Clerk, and restoring one needs SQL. SAG-143 must close both (done in the first PR, see [ADR-039](039-moderation-panel.md)).
- **The check of drawings and anime is unknown.** The rule covers them, but Sightengine's model was not tried with them, so they depend on reports.
- **This still does not look for known illegal material or recognize minors** (SAG-141).
- The IP address is personal data kept for 90 days. The privacy policy names it, and the person gets it in their export.

## Open questions

- Whether 20 a day, and hiding at the first report, are right. Nobody has used them.

## References

- OpenAI, [CSAM guidance for developers](https://developers.openai.com/api/docs/guides/csam-guidance), read 2026-11-05: clear rules, reporting for users, records and identifiers, a response playbook, humans in the loop, and limiting the exposure of reviewers.
