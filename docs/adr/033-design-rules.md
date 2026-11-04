# ADR-033: Design rules for routes, data functions and shared helpers

- **Status:** Accepted
- **Date:** 2026-11-04
- **Implementation:** Partial. The rules and the check exist (SAG-116); the code that breaks them is listed in the check and removed by SAG-73, SAG-117, SAG-118, SAG-119, SAG-120 and SAG-121.
- **Tickets:** SAG-116, SAG-73, SAG-117, SAG-118, SAG-119, SAG-120, SAG-121
- **Related:** [ADR-031](031-social-graph.md), [ADR-018](018-personal-library.md), [ADR-007](007-background-work.md)

## Context

SAG-116 reviewed the code against SOLID and good design (`docs/reviews/2026-11-architecture-review.md`). The code is functional TypeScript with few classes, so SOLID applies through its goals: one reason to change per module, small interfaces, and one copy of each rule. The review found the same security rule written by hand many times (16 body drains, 15 `privateHeaders`), one data module with five reasons to change (`server/db/social.ts`) and four route files over 600 lines. Nothing was broken, but a fix to one copy would leave the others behind.

## Decision

These rules apply to new code now and to old code as each ticket lands.

1. **A route reads, calls and answers.** It parses the request with Zod, checks the origin, calls one function of `server/` and answers. The logic of each button of an `action` lives in a function under `server/` that the tests know, not in the route.
2. **A data function is one statement with the id of the session** in its `WHERE`, takes the database as a parameter (`SqlExecutor`), and answers the same for "may not see" and "does not exist" when it shows a person to another (ADR-031). A module under `server/db/` has one reason to change; when a second one appears, it is split.
3. **A policy is pure.** `canView` and its like read no database and no request.
4. **A rule is written once.** A helper used by two files moves to the nearest shared place: `app/lib/` if the client may import it, `server/http/` for requests and answers, `server/db/` for data. Do not copy a rule into a route, above all one about security: what is never cached, how a body is drained, who may see a profile.
5. **No abstraction without a second use.** Do not add a layer, interface or base class that one caller asks for. Two real callers that need the same rule are the reason to extract it.
6. **A file over 600 lines is split** (components for a screen; modules by reason to change for data). Existing files over the limit are listed in `app/architecture.test.ts` until their ticket splits them.
7. **A refactor changes no behavior.** The tests that existed before must pass unchanged; measure bundle size, statements per page and subrequests of the crons before and after when the change could move them.

The check is `app/architecture.test.ts`. For each rule it lists the files that still break it. The list can only shrink: a new file that breaks the rule fails, and a listed file that was fixed fails until it is removed from the list. It currently checks the file size (rule 6), a route that writes its own body drain, and a file that defines its own `privateHeaders` (rule 4). A rule that a tool cannot check (1, 2, 5) is checked in review, with the line added to the pull request template.

## Alternatives considered

- **An ESLint rule for each point.** Better messages in the editor, but a change to the lint configuration, and a rule that counts lines or looks for a copy of a function needs a plugin. The test needs nothing new and works like the one for `textLinkClass`. A lint rule can replace a check later if one proves worth it.
- **Fix everything inside SAG-116.** One very large change that is hard to review and to undo. The review became tickets, each with its own branch and checks.
- **A strict limit with no exceptions.** It would fail today on four files. The list makes the debt visible and lets the rule protect new code from the first day.

## Consequences

- New copies of the known problems fail in CI, in the Quality job, with the file name.
- Each fix ticket must also edit the lists in `app/architecture.test.ts`; forgetting it fails the test, which is the intended reminder.
- The limit of 600 lines is a convention, not a measure of quality. A file under it can still do too much; the review of a pull request decides that.

## Open questions

- Whether to move the rules into ESLint once the lists are empty.
- Whether a limit for `server/db/` modules lower than 600 (the ticket SAG-118 aims at 300) should become a check after that split.

## References

- `docs/reviews/2026-11-architecture-review.md`, measured on 2026-11-04 at `ec817d6`.
