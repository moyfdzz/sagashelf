---
description: Run every pre-commit check and report the result
---

Run these in order from the repo root and stop at the first failure:

1. `npm run lint`
2. `npm run format:check`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`

Report each step as passed or failed. For a failure, show the relevant error output and propose a fix, but do not apply it unless I ask. If a script does not exist in `package.json`, say so instead of skipping it silently.

When all pass, show `git status --short` and remind me to review `git diff --staged` before committing.
