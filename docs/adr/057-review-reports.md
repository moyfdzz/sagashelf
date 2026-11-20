# ADR-057: Reports on a review keep its author, and a moderator can remove it or ask for a spoiler mark

- **Status:** Accepted
- **Date:** 2026-11-20
- **Implementation:** Done (SAG-22, the pull request of reports on a review)
- **Tickets:** SAG-22

## Context

[ADR-053](053-review-anti-abuse.md) said that a review becomes one more kind of report, and [ADR-056](056-review-likes-and-order.md) left a column, `reviews.removed_at`, that every reader of a review already checks but nothing wrote. The report flow ([ADR-038](038-reports-and-picture-records.md) to [ADR-043](043-report-again-after-an-answer.md)) knew two kinds: a person and a picture. A report of a picture keeps the person in `target_id` and the picture in `picture_url`, so every action on the person (warn, suspend, ban) works on it.

Three questions were open: what a report of a review points at, what a moderator can do about it, and what its author sees.

## Decision

Decided with the owner on 2026-11-20.

- **A report of a review keeps its author in `target_id` and the review in a new column, `reports.review_id`**, the same shape as a report of a picture. The author is known after the review is deleted, so a moderator can still warn, suspend or ban a person who deletes a review and writes it again. `review_id` has no foreign key (a report outlives what it is about) and a check makes it present exactly for the kind `review`. The unique index of the open reports of one person includes it, so two reviews of the same author are two reports.
- **Who may report a review:** anybody the title page shows it to (`reviewShown`), never its author. Anything else answers the same 404 (ADR-031). The page is `/reviews/:id/report`, a session page linked from every review that is not the viewer's own, on the title page and in the feed. The daily cap of 20 reports and the alert to the administrators are the ones of every report.
- **The reasons of a review:** an unmarked spoiler, spam, harassment, hate, sexual content and another reason. **An unmarked spoiler and another reason need the details** written by the reporter (what it gives away, or what the problem is), so the moderator does not have to read the whole review for it. `spoiler` is a new value of `report_reason`.
- **What a moderator can do from the panel**, where the card shows the whole text (spoilers included: that is what is judged), the title and whether it has the mark:
  - **Remove the review** (with a confirmation): `removed_at` is set, every open report of that review is resolved, the author gets a notification with the title and the reason, and the audit log keeps it. One statement. Removing is not an edit: `updated_at` stays.
  - **Ask the author to mark it as a spoiler**, for a review with no mark: `reviews.spoiler_requested_at` is set, every open report of it waits (`reviewing`), and the author gets a notification and a notice above the form of the review. The card then says when it was asked and whether the author did it. **Once marked, one button closes the reports as resolved; if not, the moderator removes it.** Nothing is removed on its own after a time.
  - **Dismiss** the report, or **warn, suspend or ban** the author, as for any report. A warning names the kind `review` and its reason.
  - Nothing is done to the review of an administrator or of the moderator who asks, like any action on a person.
- **The message to the author is a fixed text, never free text**, like the warning of ADR-040: the title and the reason, never who reported. A moderator does not write to a person from the panel.
- **What the author sees of a removed review:** it is hidden from everybody else, and they still see it on the title page, in their feed and on its page with a note that a moderator removed it. **It can no longer be edited, only deleted** (`saveReview` answers `removed`): an edit would stay hidden and would only look like it fixed something.
- **A report of a review that was deleted since** is still listed; the card says the review no longer exists and leaves the actions on the person.

## Alternatives considered

- **The review in `target_id`, with no author in the report.** No new column, but a review deleted after the report leaves nobody to act on, and every action on a person would need a second way to find them.
- **A foreign key from the report to the review.** It would stop a report from outliving the review, which is the evidence a moderator needs.
- **Only remove or dismiss.** Simpler, but an unmarked spoiler is something the author can fix; removing a good review for a missing checkbox is too harsh.
- **Mark the spoiler from the panel.** One click, but it changes what a person wrote without asking them, and they would never learn the rule.
- **Remove on its own if the author does not mark it in a few days.** Less work for the moderator, but a job and a deadline to explain for something that happens rarely; the card shows how long it has waited.
- **A free-text message from the moderator.** More flexible, but a text an administrator writes to a person needs its own rules (length, tone, a record); the fixed texts say what is needed.

## Consequences

- Migration `0038_review_reports` adds two enum values, two columns, a check and a new unique index, and widens the types of `notifications`. The panel and the report page compare with `'review'`, so **the migration is applied before the merge**; the title page and the feed never read `reports`.
- Two new notification types for the author (`moderation.review_removed`, `moderation.review_spoiler`). Their payload names only a title, so the erasure of the author removes them with the rest of their notifications.
- The export of the reports a person made names the author of a reported review, like a report of a person names that person.
- `db/review-reports.integration.test.ts` holds the expected rows of each action, written by hand from this record.

## References

- [ADR-031](031-social-graph.md), [ADR-038](038-reports-and-picture-records.md), [ADR-040](040-warn-suspend-ban.md), [ADR-043](043-report-again-after-an-answer.md), [ADR-053](053-review-anti-abuse.md), [ADR-056](056-review-likes-and-order.md).
- SAG-22 and the decisions of 2026-11-20 (private ticket repository).
