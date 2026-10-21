# ADR-010: CI, security scans, previews and the `main` ruleset

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Done (SAG-4 and SAG-5)
- **Tickets:** SAG-4, SAG-5, SAG-7

## Context

One person builds the product and deploys continuously. Nobody else reviews the code, so the pipeline and the repository rules must catch what a second reviewer would: failing tests, secrets, vulnerable dependencies, inaccessible pages, and direct pushes to `main`. The repository is public, so everything below is visible, and secrets must never be needed in it.

## Decision

### Local checks

- `npm run check` runs lint, format check, typecheck, unit tests with coverage (at least 80% for `server/`) and build. The same command is what CI runs.
- Husky hooks run lint-staged (ESLint and Prettier on staged files) before each commit and commitlint on the message. They are never skipped with `--no-verify`.
- **Conventional Commits with the ticket as scope**, for example `feat(SAG-12): add saga page`, enforced by commitlint. One ticket per branch, cut from an up-to-date `main`.
- A pull request template with four sections: Summary (with the ticket), Changes, Verification, Notes for the reviewer.
- ESLint stays on **version 9** because `eslint-plugin-react` and `eslint-plugin-jsx-a11y` do not support version 10 yet. Dependabot ignores major updates of `eslint`, `@eslint/js` and `@types/node` (the types follow the minimum supported Node, 22).

### GitHub Actions

- **Least privilege:** workflow permissions are `contents: read`; only CodeQL adds `security-events: write`. Checkout does not persist credentials.
- **Actions are pinned to a full commit hash** with the version in a comment, and Dependabot proposes updates weekly, grouped.
- **Jobs:** Quality (`npm run check`), Integration (constraint tests on a throwaway Postgres 18 service container, SAG-9), E2E (Playwright and axe on desktop and Pixel 7 against the production build, in Spanish and English), Lighthouse, PR title (commitlint), gitleaks, CodeQL (JavaScript and TypeScript), dependency review (fails on high severity) and `npm audit --omit=dev` (reported, not blocking).
- **Lighthouse is informational for now.** Its budgets (performance 0.9, accessibility, best practices and SEO 0.95, LCP 2.5 s, CLS 0.1) warn but do not fail, because the first measurements on an almost empty page were slow and noisy. Reports are kept as artifacts and are not uploaded to a public service. It becomes blocking when the site has more pages.
- The **PR title is linted** because the squash merge uses it as the commit message.

### Previews and production

- **Cloudflare Workers Builds** is connected to the repository (the GitHub app is limited to this repository). A push to `main` deploys production; every other branch gets a preview. The non-production deploy command is `wrangler versions upload`.
- **Worker Previews** requires a `previews` block in `wrangler.jsonc`. Previews run with `APP_ENV=preview` and never reuse production values.

### The `main` ruleset

- A pull request is required, with **0 approvals** (a sole developer cannot approve their own PR), **squash merge only**, **linear history**, **no force push, no deletion**, and **no bypass actors**, so the rules also apply to the owner.
- **Required checks:** Quality, E2E, PR title, Secrets (gitleaks), CodeQL, Dependency review and Workers Builds. Lighthouse and `npm audit` are not required. Branches are deleted automatically after a merge.
- Changes to workflows and to the ruleset itself need the owner's explicit confirmation before they are merged.

## Alternatives considered

- **Require one approving review.** Not possible for a sole developer. The required checks and the pull request itself are the control.
- **Deploy from GitHub Actions with a Cloudflare API token.** Works, but puts a deploy credential in the repository settings. Workers Builds keeps it inside Cloudflare.
- **Floating action tags (`@v4`).** Easier, but a moved tag can run different code tomorrow. Pinned hashes plus Dependabot keep updates deliberate.
- **Merge commits or rebase merges.** They keep every intermediate commit in `main`. Squash gives one commit per ticket with a linted title.
- **Make Lighthouse blocking from the start.** Would block merges on noise. Deferred.

## Consequences

**Good**

- A change cannot reach `main` without passing the same checks locally and in CI, and the history reads as one commit per ticket.
- A leaked secret fails CI. This was verified with a throwaway pull request that contained an invented key.

**Costs and risks**

- **Cloudflare is now a required check.** If its build does not start, merges are blocked. This happened once: Cloudflare never received the push for a branch, and an empty commit to the same branch triggered the build. An outage at Cloudflare would block merges until the check is removed from the ruleset.
- **Previews are publicly reachable.** Cloudflare Access could limit them to the owner (see ADR-006).
- **Dependabot noise.** It opened pull requests for major versions that cannot be taken yet, which the ignore rules now prevent. It also links them to SAG-5 in Linear because of the commit prefix.
- On 2026-10-20 there were six open Dependabot alerts, all in development dependencies of `@lhci/cli`, tracked separately.

## Open questions

- When to make Lighthouse blocking, and what to do about the slow largest contentful paint measured on a near-empty page (about 3 s locally).
- Whether to require Cloudflare Access on previews.

## References

- Tickets SAG-4 and SAG-5 (Linear); pull requests #3, #4, #9, #10 and #11
