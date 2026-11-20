---
description: Run every pre-commit check and report the result
---

Run the checks from the repo root, in this order, and stop at the first failure:

1. `npm run check` (lint, format check, typecheck, unit tests with coverage, build and size budgets). It stops at the first failing test and then does not build.
2. If the branch changes `server/db`, `db/` or `drizzle/`: `npm run test:integration` (Docker must be on; never two runs at once).
3. If the branch changes UI or routes: `npm run test:e2e:local -- --a11y` (the e2e suite like CI, then axe on its build).

Read the result lines of each log (the `Tests` lines and the exit code of the check itself, not of an `echo`). Report each step as passed, failed or not run (and why). For a failure, show the relevant error output and propose a fix, but do not apply it unless I ask.

When all pass, show `git status --short` and remind me to review `git diff --staged` before committing.
