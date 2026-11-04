# Architecture review, November 2026 (SAG-116)

Status: first pass, ranked. Each finding ends as **fix** (its own ticket), **keep** (already good) or **reject** (with the reason). Nothing here changes behavior.

## How it was made, and what it did not cover

Measured on `main` at `ec817d6` (2026-11-04): the size of every non-test file under `app/`, `server/`, `workers/` and `db/`, a search for copies of the same helper, a check of the direction of imports, and a read of `server/db/social.ts`, the two profile lookups and the helpers below. **Not covered yet:** a line-by-line read of the providers, jobs, `workers/` and `e2e/`, and no baseline of bundle size or statements per page. Those are measured in the ticket that touches them, before and after.

## What is already good (keep it)

- **Direction of imports.** Nothing under `server/`, `workers/` or `db/` imports from `app/`, and ESLint stops `app/components` and `app/lib` from importing `server/`.
- **`canView` / `canSeeCard`** are one pure policy, tested table by table (ADR-031).
- **Data functions take the database as a parameter** (`SqlExecutor`), so they run against the real Postgres in `db/` tests and against mocks in route tests.
- **One function, one statement, with the id of the session.** It is the only atomic unit on Neon over HTTPS and it keeps authorization in the query.
- **One module validates the environment** (`server/env.ts`), one ADR per decision, and the allow-list test of `textLinkClass` shows how to turn a rule into a check.

## Findings, ranked

Risk first, then cost. "Copies" were counted by searching the source on 2026-11-04.

### High: copies of a security rule

1. **`answerWithoutReading` is defined 16 times** (`api.locale.ts`, `webhooks.clerk.ts` and 14 more routes, in two variants: `Response` and generic `<T>`). It protects against a connection that breaks when a POST is answered before its body is read. A fix to one copy leaves the others behind. **Fix, but first check SAG-73:** `answerAndDrain` in `workers/app.ts` already covers every route, so most copies may simply be deleted. **Done in SAG-73:** `answerAndDrain` did cover every route, so the 16 copies and the five `drainBody` calls of `requireUser` and `readAdminWrite` were deleted, and no helper was needed.
2. **`privateHeaders` is defined in 15 routes, the string `"private, no-store"` appears 26 times, and 18 routes export their own `headers()`.** The rule "an answer with a person's data is never cached" is written by hand each time, so a new route can forget it. **Done in SAG-117:** one `privateHeaders` constant and two shared `headers` exports (`privateRouteHeaders`, and `mergePrivateHeaders` for a route with an action) in `server/http/cache.ts`, not in `app/lib/` as first proposed, so that `server/auth/admin-write.ts` can use them without `server/` importing from `app/`. The string is written once, and `app/architecture.test.ts` fails if a route writes it again.

### High: one module with several reasons to change

3. **`server/db/social.ts` (481 lines)** holds follow, block, mute, the relationship, the two profile lookups, the lists of people, the counts, and three constants. **Fix:** split by reason to change into `follows`, `blocks-mutes`, `profile` (lookups), `people-lists` and `counts`, keeping the exports and every statement as they are. `follow-requests.ts` is already its own module and stays. The split is a move, so the existing integration tests are the safety net.

### Medium

4. **`findViewableProfile` and `findProfile` repeat the same query and the same building of the profile head.** **Fix:** one private query inside `profile`, two thin public functions. Do it right after finding 3, in the same file.
5. **`asDate` is defined 6 times with 3 different meanings** (`number`, `Date | null`, `Date`). The ticket assumed plain copies; they are not. **Fix:** unify only the three that are identical (`follow-requests.ts`, `notifications.ts`, `webhooks.ts`) in one `server/db/dates.ts`; give the others names that say what they return (`asDateOrNull`) so nobody mixes them up.
6. **`usernameShape` is defined twice** (`u.$username.tsx`, `u.$username.$kind.tsx`), not three times. **Fix:** put it next to the other username rules, after reading `server/db/username.ts` to avoid a third place.
7. **Four routes have an `action` that is a `switch` on `intent`** with the logic of each button (`notifications.tsx`, `settings.notifications.tsx`, `u.$username.tsx`, `admin.sagas.$id.tsx`). **Fix, one route per ticket, only where it pays:** move each button's logic to a small function in `server/` that the tests already know, and leave the route to read the form, check the origin and answer. Start with `u.$username.tsx`, the largest.
8. **Four route files were over 600 lines:** `library.$mediaId.tsx` 1008, `stats.tsx` 782, `library.tsx` 705, `settings.notifications.tsx` 607. After SAG-73 and SAG-117 removed copies, `settings.notifications.tsx` has 591, so three are left (989, 781 and 701 lines). **Fix, last:** split the screen into components, keep the loader and action where they are. This is the highest cost and the lowest risk, so it comes after the rules exist.

### Rejected

9. **`toPerson`** exists once, in `social.ts`; it is not a copy. It moves with the split (finding 3).
10. **The `text` helper** no longer exists; only `textCode` (specific to profile errors) is left in `settings.profile.tsx`.
11. **Splitting `server/db/webhooks.ts` (514), `library.ts` (473) and `stats.ts` (401)** for size alone. No second reason to change was found; look again only if a ticket adds one.

## Tickets

| Ticket  | What                                                          | Findings | Size   |
| ------- | ------------------------------------------------------------- | -------- | ------ |
| SAG-73  | Drop the 16 copies of `answerWithoutReading`                  | 1        | S      |
| SAG-117 | One shared `privateHeaders` and `headers`                     | 2        | S      |
| SAG-118 | Split `server/db/social.ts` and merge the two profile lookups | 3, 4     | M      |
| SAG-119 | One home for `asDate` and `usernameShape`                     | 5, 6     | S      |
| SAG-120 | Thin the `action` of four routes, `u.$username.tsx` first     | 7        | M each |
| SAG-121 | Split the four route files over 600 lines                     | 8        | M each |

The rules and the automatic check (ADR-033, `app/architecture.test.ts`) came with this review, so the copies cannot return while they are removed. Each ticket also removes its files from the lists in that test.
