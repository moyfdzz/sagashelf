# SagaShelf

**[sagashelf.app](https://sagashelf.app)** · Status: **rebuilding**

SagaShelf is a personal, non-commercial portfolio project: a web app to search, track and share anime, movies, series, books and manga. Its signature feature is **sagas**: one page per story across every format (for example, Dune as books and films, or Attack on Titan as manga, anime and films) with your progress in each.

## Planned features

- Search and library for anime, movies, series, books and manga
- Sagas that group every format of a story, with per-user progress
- Social layer: follow, friends (mutual follows), block, public/friends/private profiles
- Custom entries for titles missing from the catalog
- Trending pages, an admin dashboard, and incoming/outgoing webhooks
- Spanish (default) and English, responsive on phone, tablet and desktop

## Tech stack (target)

- TypeScript (strict), React Router v8 (framework mode, SSR), Tailwind CSS, Zod
- Cloudflare Workers
- Postgres on Neon with Drizzle (planned)
- Clerk for accounts (planned; passwords are never stored by this app)
- Vitest, Playwright, GitHub Actions

## Getting started

Requires Node 22.22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run lint`, `npm run format`, `npm run typecheck`, `npm run test`, `npm run test:coverage`, `npm run test:e2e` (run `npx playwright install chromium` once), `npm run build`, and `npm run check` to run everything before a commit.

Commits follow Conventional Commits with the ticket as scope, for example `feat(SAG-12): add saga page`. Git hooks check staged files and the commit message.

## Documentation

- [Architecture overview](docs/architecture.md) with diagrams of the system, a request, search, webhooks, the data model and delivery
- [Decision records](docs/adr/README.md): why each major choice was made, what else was considered, and what it costs

## Security

Secrets never go in the repository. Copy `.env.example` to `.dev.vars` and fill it in locally; `.env*` files (except `.env.example`) and `.dev.vars*` are gitignored. Production values are Workers secrets.

## License

MIT. See the `LICENSE` file.

## Contact

- GitHub: [moyfdzz](https://github.com/moyfdzz)
- Email: contact@sagashelf.app
