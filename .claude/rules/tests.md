---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "db/**"
  - "server/testing/**"
  - "vitest.config.ts"
  - "vitest.integration.config.ts"
---

# Test rules

- **A new test must be shown to fail on the old code**: `git stash push -- <tracked source files>`, run, `git stash pop`, check the stash list is empty (in a worktree use `git diff --output` and `git apply`). It must also **pass on the good code first**, or a badly written assertion "catches" everything (SAG-113).
- **For a new untracked file use mutation checks**: a script in the scratchpad that, for each rule, replaces one exact piece of the code (asserting it appears once), runs the tests, records whether one failed, and restores the file in a `finally`. A mutation that is **missed** is a finding (it showed real test gaps several times). A new guard test is proven by adding a bad copy for a moment and reverting it.
- **A guard that reads the database through a mocked chain cannot prove a `WHERE` filter**: the mock returns what it is told. Put the filter in a data function that takes the database as a parameter (`findSessionUser`, SAG-166), test it on the real Postgres in `db/`, and in the unit test read the condition the mock receives with `new PgDialect().sqlToQuery(...)` (match with regular expressions). Prove both fail with the filter removed.
- **A test that a custom title stays hidden must write its library entry by hand**: `addEntry` refuses a custom title, so a reader that joins the entry hides the row for that reason and the test passes without `sharedTitleSql` (SAG-22's mutation check missed it until the entry was inserted with SQL).
- **A fixture or a test can be wrong, not the code**, and a real defect can hide in a test that "fails for a silly reason": read the failure before changing the code. `dialog.close()` fires its `close` event later, so a listener attached right after takes it for the user.
- **A test of the repo can pin a pending decision** (`app/styles.test.ts` forbade `scrollbar-gutter` until SAG-63 decided): read the ticket that wrote a test before changing it.
- **MSW** (`server/testing/`) fails any unhandled request, so tests never reach the network; each provider adds its fixtures there.
- **Fake secrets stay obviously fake and low entropy**: gitleaks scans every commit of a PR and flags a made-up token.
- The lint forbids `!` in tests too (`no-non-null-assertion`).
- **Vitest 5 cannot print an error thrown by a `globalSetup`**: it shows "No test files found" and `code.charCodeAt is not a function` instead. Write the reason with `console.error` before throwing (`stopRun` in `db/global-setup.ts`), and read the lines above that message.

## Proving a big refactor (how SAG-121 did it, reuse it)

1. A throwaway vitest file in `app/routes/` copies the harness of a render test and writes the HTML of 100 to 150 states to a JSON file in the scratchpad (every kind of data, every error, both languages); check first that rendering twice gives the same bytes.
2. Cut the code with a **script that copies line ranges from `git show HEAD:<file>`**, asserts each range starts and ends where expected, and refuses to write if one does not (never retype 600 lines of JSX).
3. Render the same states again and `cmp` the files: byte for byte the same.
4. Delete the throwaway test, and compare the sizes of `build/client/assets/*.js` before and after. For moved SQL, compare the text of every `sql` template of the old file and the new ones.
