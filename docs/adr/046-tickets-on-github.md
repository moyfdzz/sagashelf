# ADR-046: Tickets in a private GitHub repository, not in Linear

- **Status:** Accepted
- **Date:** 2026-11-08
- **Implementation:** Done (SAG-216)
- **Tickets:** SAG-216
- **Related:** [ADR-010](010-ci-cd-and-repository-rules.md)

## Context

Until now every ticket lived in a Linear workspace (team SagaShelf, `SAG-N`). On 2026-11-08 the workspace reached the limit of the free plan and Linear no longer let us create tickets. Linear has no manual archive button to make room, so the owner decided to move.

The repository `moyfdzz/sagashelf` is public. Many tickets have an "Agent notes" block with findings of the security reviews that are not fixed yet. They must not be published. The commits use the scope `SAG-N` and commitlint enforces it, and ADRs and docs cite tickets by that number, so the numbers had to survive.

## Decision

- The tickets are issues of a **private** repository, `moyfdzz/sagashelf-tickets`, with a GitHub Project "SagaShelf tickets" (number 1 of the owner) whose field **Status** has three columns: Backlog, In Progress and Done.
- The title of each issue starts with its number, `SAG-N: <title>`, and the issue number is N (the 215 tickets were created in order into an empty repository, so SAG-1 is issue 1 and SAG-215 is issue 215). New tickets continue from the next number. commitlint, branches, commits and ADRs keep using `SAG-N` unchanged.
- Status is the column of the Project; a Done ticket is a closed issue. Priority is a label (`priority:urgent`, `priority:high`, `priority:medium`, `priority:low`) and the original Linear labels (Security, Bug, Feature, Improvement, Docs, Chore, CI/CD) were kept.
- Each migrated issue says at the top where it came from (the Linear address, its status and priority there, and its creation and completion dates, since GitHub does not let a date be set). Relations are text with the `SAG-N`. The comments are real comments with the author and the original date in the text. The collapsible "Agent notes" is a `<details>` block.
- **The ticket is closed by hand after the merge.** A PR cannot close an issue of another repository, so nothing closes a ticket by mistake any more (SAG-29 and SAG-135 had to be reopened when Linear did). The rule "never write close, closes or fixes next to a ticket number in a PR body" stays, because it is harmless here and a bare `#N` would point to an issue of the wrong repository.
- Agents work with the `gh` CLI (`gh issue`, `gh project`). The Linear connector is not used.
- The "(Linear)" lines of the earlier ADRs, and the review of 2026-11 that names Linear, are left as they were written: they record where the ticket was at the time, and the number is still the number. From now on they mean the issue of the same number in the tickets repository.

## Alternatives considered

- **The issues of the public repository.** The simplest, and the numbers would have followed the PRs, but it publishes unfixed findings. Rejected.
- **Pay for Linear.** Not worth it for a personal, non-commercial project with one owner.
- **Delete or merge old tickets to get under the limit.** It loses history that the ADRs point to, and the limit would come back.
- **Markdown files in the repository.** They would be public too, and a search or a board would have to be built by hand.

## Consequences

- Better: no limit that blocks the work, tickets and code on the same platform, and the history of the 215 tickets is kept with their comments and links to the PRs.
- Worse: the numbers of the issues and of the PRs of the public repository can coincide (issue 120 of the tickets repository and PR 120 of this one are different things), so a PR is written as `moyfdzz/sagashelf#N` in a ticket, never as a bare `#N`. The conversion was done in the migrated text.
- The dates of the comments of GitHub are the day of the migration; the original date is in the text. What Linear kept apart from the text (assignee, activity history, cycles) was not moved. The 56 issues of another Linear team were not moved.
- The tickets repository is private, so a ticket can hold a finding. It still must never be pasted in the public repository, a PR or a commit message.
- Linear keeps an old copy until the owner deletes it. The export used for the move holds unfixed findings and must not be put in any repository.

## Open questions

- None. When to delete the Linear workspace is the owner's choice.

## References

- The export of Linear and the dump of the tickets, read on 2026-11-08 (kept by the owner, not in this repository).
