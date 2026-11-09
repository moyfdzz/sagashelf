---
description: Start work on a ticket (usage: /start-ticket SAG-N)
---

Start work on ticket $ARGUMENTS. Tickets are issues of the private repository `moyfdzz/sagashelf-tickets`; the issue number is the number of the ticket (`SAG-166` is issue 166). Never copy the text of a ticket into this public repository.

1. Read the whole ticket (description, scope, acceptance criteria, relations, comments): `gh issue view <N> --repo moyfdzz/sagashelf-tickets --comments`.
2. Update `main` (`git checkout main; git pull --ff-only`) and create a branch `<type>/SAG-N-<short-slug>` from it.
3. Move the card to In Progress in the Project (number 1 of the owner). Get the ids with `gh project field-list 1 --owner moyfdzz --format json` (the field **Status** and its option In Progress), `gh project view 1 --owner moyfdzz --format json --jq .id` (the project id) and `gh project item-list 1 --owner moyfdzz --limit 500 --format json` (the item whose `content.number` is N), then `gh project item-edit --project-id <id> --id <item> --field-id <status field> --single-select-option-id <In Progress option>`.
4. Tell me your plan step by step, in simple language, and list any decision you need from me. Do not change files until I confirm.

Do not push, open a PR or change CI, DNS or secrets without asking me first. GitHub does not close the issue when the PR is merged: it is closed by hand after the merge.
