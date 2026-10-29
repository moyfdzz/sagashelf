# SagaShelf

**[sagashelf.app](https://sagashelf.app)** · Status: **live, in active development**

SagaShelf is a personal, non-commercial portfolio project: a web app to search, track and share anime, movies, series, books and manga. Its signature feature is **sagas**: one page per story across every format (for example, Dune as books and films, or Attack on Titan as manga, anime and films) with your progress in each.

## What works today

- Search for movies, series, anime, books and manga, with a page for each title (synopsis, seasons and episodes, authors, credits). Movie, series and anime data comes from TMDB, book data from Open Library and manga data from MangaDex.
- A personal library: statuses, progress (episodes, or pages, chapters and volumes for books and manga), scores, private notes, and a history of the times you watched a title, and quick actions without opening the entry: a +1 on each row of the library to add an episode, page, chapter or volume, and, on a title page, add it, change its status and count one more. A result of the search can be added to the library without opening it. It has tabs by type, search, filters, sort and list or grid views.
- Accounts with Clerk (email or Google), a profile with a privacy level, and a username you can change.
- Your data is yours: download a copy of it, restore your library from that copy, or delete your account and everything in it.
- Spanish (default) and English, light and dark mode, responsive on phone, tablet and desktop.

## Planned

- Sagas that group every format of a story, with per-user progress
- Google Books as a fallback for books, the volumes of a manga, and more sources for series and anime
- Social layer: follow, friends (mutual follows), block, public/friends/private profiles
- Custom entries for titles missing from the catalog
- Trending pages, statistics, an admin dashboard, and incoming/outgoing webhooks

The design behind each of them is in the [decision records](docs/adr/README.md).

## Tech stack

- TypeScript (strict), React Router v8 (framework mode, SSR), Tailwind CSS, Zod
- Cloudflare Workers, with a Cron Trigger that keeps the provider data fresh
- Postgres on Neon with Drizzle
- Clerk for accounts (passwords are never stored by this app)
- Vitest, Playwright and GitHub Actions

## Getting started

Requires Node 22.22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run lint`, `npm run format`, `npm run typecheck`, `npm run test`, `npm run test:coverage`, `npm run test:e2e` (run `npx playwright install chromium` once), `npm run build`, and `npm run check` to run everything before a commit.

Commits follow Conventional Commits with the ticket as scope, for example `feat(SAG-12): add saga page`. Git hooks check staged files and the commit message. Every pull request runs the quality checks, the database tests, the end-to-end tests and the security scans in GitHub Actions.

## Documentation

- [Architecture overview](docs/architecture.md) with diagrams of the system, a request, search, webhooks, the data model and delivery
- [Decision records](docs/adr/README.md): why each major choice was made, what else was considered, and what it costs
- [Edge setup](docs/edge-setup.md): the Cloudflare and Clerk settings that live in dashboards and not in the code

## Database (local)

The database needs Docker. `npm run db:up` starts Postgres 18 on this computer, `npm run db:migrate` builds the schema, and `npm run db:seed` loads synthetic data (no real people). `npm run test:integration` runs the tests that need Postgres, and `npm run check:full` runs every check.

For the app to use it, copy `.env.example` to `.dev.vars` and set `DATABASE_URL=postgres://sagashelf@127.0.0.1:5432/sagashelf`. Production and previews use Neon; their connection strings are Workers secrets and never go in a file.

## Security

Secrets never go in the repository. Copy `.env.example` to `.dev.vars` and fill it in locally; `.env*` files (except `.env.example`) and `.dev.vars*` are gitignored. Production values are Workers secrets.

## License

MIT. See the `LICENSE` file.

## Contact

- GitHub: [moyfdzz](https://github.com/moyfdzz)
- Email: contact@sagashelf.app
