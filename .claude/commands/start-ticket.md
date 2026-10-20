---
description: Start work on a Linear ticket (usage: /start-ticket SAG-N)
---

Start work on ticket $ARGUMENTS.

1. Read the whole ticket in Linear (description, scope, acceptance criteria, relations).
2. Update `main` (`git checkout main; git pull --ff-only`) and create a branch `<type>/SAG-N-<short-slug>` from it.
3. Move the ticket to In Progress in Linear.
4. Tell me your plan step by step, in simple language, and list any decision you need from me. Do not change files until I confirm.

Do not push, open a PR or change CI, DNS or secrets without asking me first.
