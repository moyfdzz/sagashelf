# SagaShelf

**[sagashelf.app](https://sagashelf.app)** · Status: **rebuilding**

SagaShelf is a personal, non-commercial portfolio project: a web app to search, track and share anime, movies, series, books and manga. Its signature feature is **sagas**: one page per story across every format (for example, Dune as books and films, or Attack on Titan as manga, anime and films) with your progress in each.

> The code currently in this repository is an early prototype that is being replaced by a new TypeScript app. The prototype does not start: `backend/routes/userMedia.routes.js` imports a controller that does not exist. It is kept only as a reference until the new app lands.

## Planned features

- Search and library for anime, movies, series, books and manga
- Sagas that group every format of a story, with per-user progress
- Social layer: follow, friends (mutual follows), block, public/friends/private profiles
- Custom entries for titles missing from the catalog
- Trending pages, an admin dashboard, and incoming/outgoing webhooks
- English and Spanish, responsive on phone, tablet and desktop

## Tech stack (target)

- TypeScript (strict), React Router v7 (framework mode, SSR), Tailwind CSS, Zod
- Cloudflare Workers
- Postgres on Neon with Drizzle
- Clerk for accounts (passwords are never stored by this app)
- Vitest, Playwright, GitHub Actions

## Running the prototype (reference only)

```bash
cd backend && npm install
cp ../.env.example .env   # then fill in the values locally; never commit .env
cd ../frontend && npm install
```

The new app will replace this setup, and these instructions will be updated then.

## Security

Secrets never go in the repository. Copy `.env.example` to `.env` and fill it in locally; `.env*` files (except `.env.example`) are gitignored.

## License

MIT. See the `LICENSE` file.

## Contact

- GitHub: [moyfdzz](https://github.com/moyfdzz)
- Email: contact@sagashelf.app
