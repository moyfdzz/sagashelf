# SagaShelf

Personal, non-commercial portfolio app to search and track anime, movies, series, books and manga, with "sagas" that group every format of a story. This file holds only public project facts. Personal rules (attribution, secrets, git confirmations) live in each developer's user-level settings; private notes go in `CLAUDE.local.md` (gitignored).

## Stack

TypeScript (strict), React Router v8 (framework mode, SSR) on Cloudflare Workers, Tailwind v4, Zod, Postgres on Neon with Drizzle, Clerk for accounts, Vitest, Playwright, GitHub Actions. Do not propose replacing these.

- React Router v8 comes from the official Cloudflare template. Import from `react-router`, never `react-router-dom` (removed in v8).
- Node 22.22 or newer (`engines` in `package.json`).

## Commands

| Command                 | What it does                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Local dev server at http://localhost:5173                                                                                 |
| `npm run lint`          | ESLint                                                                                                                    |
| `npm run format`        | Prettier (write); `format:check` only checks                                                                              |
| `npm run typecheck`     | `wrangler types`, route typegen and `tsc -b`                                                                              |
| `npm run test`          | Vitest unit tests                                                                                                         |
| `npm run test:coverage` | Vitest with coverage; `server/` must stay at 80% or more                                                                  |
| `npm run test:e2e`      | Playwright on desktop and Pixel 7, with axe and a no-sideways-scroll check (needs `npx playwright install chromium` once) |
| `npm run build`         | Builds the Worker                                                                                                         |
| `npm run check`         | lint, format check, typecheck, test with coverage and build in order (pre-commit)                                         |

## Folder map

- `app/routes`: UI routes and resource routes (`api.*`, `webhooks.*`), declared in `app/routes.ts`
- `app/components`, `app/lib`: client-safe code. Lint forbids importing `server/` here
- `server/`: database, providers, services, jobs, env. Import it only from route loaders/actions
- `server/env.ts`: the only place environment variables are validated (Zod). Errors name the variable, never its value
- `workers/app.ts`: Worker entry (`fetch` and `scheduled` handlers)
- `app/locales`: UI text. `es.json` is the source of truth and `en.json` must have exactly the same keys. `app/middleware/i18next.ts` picks the language per request
- `server/testing/`: MSW mock server shared by all tests. Unhandled requests fail the test, so tests never reach the network; each provider adds its fixtures here
- `docs/architecture.md` and `docs/adr/`: the system overview with Mermaid diagrams, and one decision record per major decision. A change to the stack or to a major decision adds a new ADR (and marks the old one as superseded) instead of rewriting history. Facts about third-party limits and license terms are written with their source and the date they were read.
- `e2e/`: Playwright tests. Unit tests sit next to the code as `*.test.ts`

## Conventions

- One ticket (Linear team SagaShelf, `SAG-N`) per branch, cut from an up-to-date `main`, e.g. `chore/SAG-3-app-scaffold`.
- Conventional Commits with the ticket as scope: `feat(SAG-12): add saga page`. commitlint enforces the `SAG-N` scope.
- Git hooks (Husky): lint-staged runs ESLint and Prettier on staged files, and commitlint checks the message. Never bypass them with `--no-verify`.
- i18n: Spanish is the default (neutral Latin American Spanish, natural in Mexico) and English is selectable. The language is the cookie `locale`, then `Accept-Language`, then Spanish. Never write visible text in a component: add the key to both `es.json` and `en.json` and use `t("...")` (typed keys, a parity test, and an ESLint rule enforce this). Dates, numbers and relative times go through `app/lib/format.ts`, not raw `toLocaleString`.
- Security headers: every Worker response gets them from `server/security-headers.ts`, static files from `public/_headers` (a test keeps both equal), and pages get a CSP with a per-page nonce in the production build only. A feature that needs another origin adds exactly that origin to one CSP directive, in its own ticket, with a test. Write endpoints are rate limited with `rateLimit(getWriteLimiter(), ...)`, check the `Origin`, and reject bodies over a small limit.
- CI (GitHub Actions) runs Quality (`npm run check`), E2E on the production build, Lighthouse (informational for now), the PR title through commitlint, and Security (gitleaks, CodeQL, dependency review, `npm audit`). The PR title becomes the squash commit message, so it must follow Conventional Commits with the `SAG-N` scope.
- GitHub Actions are pinned to a full commit hash with the version in a comment. Dependabot proposes updates weekly; never switch a pin to a floating tag.
- ESLint stays on v9 because `eslint-plugin-react` and `eslint-plugin-jsx-a11y` do not support v10 yet.
- Before each commit: `npm run check`, then review `git diff --staged`. Stage named files, never `git add .`.
- PR with squash merge. The PR description says what changed, why, and how it was checked.
- Secrets never go in the repo: names only in `.env.example`; real values in `.dev.vars` (local) or Workers secrets.
