---
description: Start work on a ticket (usage: /start-ticket SAG-N)
---

Start work on ticket $ARGUMENTS. Tickets are issues of the private repository `moyfdzz/sagashelf-tickets`; the issue number is the number of the ticket (`SAG-166` is issue 166). Never copy the text of a ticket into this public repository.

1. Read the whole ticket (description, scope, acceptance criteria, relations, comments): `gh issue view <N> --repo moyfdzz/sagashelf-tickets --comments`.
2. Read `git status -sb`. If the shared checkout is clean: `git checkout main; git pull --ff-only; git checkout -b <type>/SAG-N-<short-slug>`. If it holds another session's work, stop and tell me; use a worktree only if I confirm two sessions run at once (`docs/agent-notes.md`, traps of worktrees).
3. Move the card to In Progress in the Project (number 1 of the owner). Get the ids with `gh project field-list 1 --owner moyfdzz --format json` (the field **Status** and its option In Progress), `gh project view 1 --owner moyfdzz --format json --jq .id` (the project id) and `gh project item-list 1 --owner moyfdzz --limit 500 --format json` (the item whose `content.number` is N), then `gh project item-edit --project-id <id> --id <item> --field-id <status field> --single-select-option-id <In Progress option>`.
4. Tell me your plan step by step, in simple language, and list any decision you need from me with a recommendation for each. Do not change files until I confirm.

When the checks are green, commit, push and open the PR without asking (standing order); then run `/code-review` yourself for a code PR. Do not change CI, DNS, secrets, hooks or permissions without asking me first. GitHub does not close the issue when the PR is merged: it is closed by hand after the merge, and the checks of the feature go to SAG-265.
