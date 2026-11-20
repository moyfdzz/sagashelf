---
name: browser-review
description: Set up and run a review of the signed-in pages of SagaShelf in a real browser (database branch, test data, signing in, language, what to measure). Use before opening the library, settings, social or admin pages with Playwright or Chrome.
---

# A review in a real browser

Found on 2026-11-08. The first full review took hours because none of this was written down. SAG-268 plans a staging Worker that would replace most of the setup.

## The database

- The dev server uses Neon over HTTPS, so the local Docker Postgres does not work for it. Use a **schema-only Neon branch**: the owner creates it and puts its pooled string in `.dev.vars` (never read that file). The Neon branch `development` holds test data; do not point `.dev.vars` at it without asking.
- A schema-only branch leaves `drizzle.__drizzle_migrations` empty: before `db:migrate`, insert the last migration by hand (`hash` is the SHA-256 of that migration's `.sql` file, `created_at` its `when` in `drizzle/meta/_journal.json`). Check the tables first. The owner runs these statements in the Neon SQL Editor with the right branch selected.

## The data

- `db/seed.ts` refuses a non-local database and starts with a `TRUNCATE`: do not work around it.
- `users` rows are created only by the Clerk webhook, which does not reach localhost, so the owner inserts them by hand: the test account (its Clerk id is not a secret) and made-up people with `example.test` emails. Privacy levels are `public`, `friends` and `private`; `private` is Total privacy (a 404 for everyone, by design).
- `/admin` needs `role = 'admin'` **and** a verified Google login; set the role back to `user` when the review ends.
- Titles and library entries are made through the app (`/library/add-external` from a search result).

## Signing in

- Google refuses a browser driven by automation ("This browser or app may not be secure"). Do not try to hide the automation: use a Clerk test account with email and password, typed by the owner.
- A Chromium started with `--remote-debugging-port=9222` keeps that session for scripts that connect with `chromium.connectOverCDP`; close it when done.

## Language

The `locale` cookie is a react-router cookie: a raw `locale=es` set from outside is ignored. Set the browser locale (`es-MX`, `en-US`) or press the language button. At 1280 px the buttons read "Español" and "English", and the header has two copies of the form (pick the visible one).

## Traps of the tools

In Chrome's device mode the clicks sent over CDP hang: measure with scripts. Dark Reader recolors the page and adds hydration errors: turn it off for `localhost`. A window-resize tool can report success and leave the viewport unchanged: check `innerWidth`. A classic scrollbar takes 15 px, so a 320 px window has 305 px of layout.

## What to measure

`scrollWidth` against `clientWidth`, elements whose right edge is past the viewport, the height of every link and button, the contrast of each text against its real background (test the detector on a known bad pair first), and whether each focused element has an outline. One run of 192 page and size combinations takes about 6 minutes.
