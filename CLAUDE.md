# SagaShelf

Personal, non-commercial portfolio app to search and track anime, movies, series, books and manga, with "sagas" that group every format of a story. This file holds only public project facts. Personal rules (attribution, secrets, git confirmations) live in each developer's user-level settings; private notes go in `CLAUDE.local.md` (gitignored).

## Stack

TypeScript (strict), React Router v8 (framework mode, SSR) on Cloudflare Workers, Tailwind v4, Zod, Postgres on Neon with Drizzle, Clerk for accounts, Vitest, Playwright, GitHub Actions. Do not propose replacing these.

- React Router v8 comes from the official Cloudflare template. Import from `react-router`, never `react-router-dom` (removed in v8).
- Node 22.22 or newer (`engines` in `package.json`).

## Commands

| Command             | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Local dev server at http://localhost:5173                           |
| `npm run lint`      | ESLint                                                              |
| `npm run format`    | Prettier (write); `format:check` only checks                        |
| `npm run typecheck` | `wrangler types`, route typegen and `tsc -b`                        |
| `npm run test`      | Vitest unit tests                                                   |
| `npm run test:e2e`  | Playwright (needs `npx playwright install chromium` once)           |
| `npm run build`     | Builds the Worker                                                   |
| `npm run check`     | lint, format check, typecheck, test and build in order (pre-commit) |

## Folder map

- `app/routes`: UI routes and resource routes (`api.*`, `webhooks.*`), declared in `app/routes.ts`
- `app/components`, `app/lib`: client-safe code. Lint forbids importing `server/` here
- `server/`: database, providers, services, jobs, env. Import it only from route loaders/actions
- `server/env.ts`: the only place environment variables are validated (Zod). Errors name the variable, never its value
- `workers/app.ts`: Worker entry (`fetch` and `scheduled` handlers)
- `e2e/`: Playwright tests. Unit tests sit next to the code as `*.test.ts`

## Conventions

- One ticket (Linear team SagaShelf, `SAG-N`) per branch, cut from an up-to-date `main`, e.g. `chore/SAG-3-app-scaffold`.
- Conventional Commits with the ticket as scope: `feat(SAG-12): add saga page`.
- Before each commit: `npm run check`, then review `git diff --staged`. Stage named files, never `git add .`.
- PR with squash merge. The PR description says what changed, why, and how it was checked.
- Secrets never go in the repo: names only in `.env.example`; real values in `.dev.vars` (local) or Workers secrets.
