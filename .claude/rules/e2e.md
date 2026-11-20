---
paths:
  - "e2e/**"
  - "playwright.config.ts"
  - "app/testing/**"
  - "vitest.a11y.config.ts"
  - "scripts/a11y-pages.mjs"
  - "lighthouserc.json"
---

# End-to-end test rules

## Running the suite like CI

Run it on the production build, with 2 workers as CI does, and with the owner's `.dev.vars` moved aside (never read its values):

`mv .dev.vars .dev.vars.aside; rm -f build/server/.dev.vars; CI=1 npx playwright test --workers=2 > log 2>&1; mv .dev.vars.aside .dev.vars`

then confirm `.dev.vars` is back. `CI=1` matters (without it 8 "static file carries the base headers" tests fail: not a regression). Run it in the background and do not run `npm run build` meanwhile. Local runs with the default 8 workers were flaky twice (`ERR_CONNECTION_REFUSED`/`ERR_ABORTED` at the start); repeat the whole suite before saying a failure is not yours, and say so in the PR (SAG-266). A leftover `wrangler dev` or `workerd` process locks `build/server` and keeps port 4173. SAG-269 plans a script for all this.

## What the CI e2e can and cannot see

- **It has no database and no session.** A page whose loader reads the database is covered by integration, loader and render tests, measured at 320 px from static HTML, and checked by `npm run test:a11y` (SAG-249: it saves the HTML of every render test drawn with `renderToString` and runs axe on it with the CSS of the build; not hydrated, always Spanish). Run `npm run build` first; it is not part of `npm run check`.
- The signed-in components (`ConfirmDialog`, `NotesPreview`, `AccountMenu`, `SearchBox`) are tested alone in `e2e/components.spec.ts`: `app/testing/e2e-harness.tsx` mounts one, `e2e/harness/mount.ts` bundles it once per worker. A new one goes in `harnessNames` (`app/testing/harness-names.ts`) and in `Page` of the harness.
- Lighthouse measures only pages with no database: home, privacy, community, credits (not `/contact`, `noindex` on purpose, and not a 404).

## Traps

- **An e2e test that adds an element must add and measure it in ONE `page.evaluate`**: the production build hydrates after `goto` returns and React removes a node it did not draw (SAG-228). Run such a test with `CI=1 --repeat-each=8 --retries=0`.
- **Playwright hides the scrollbars by default**, so width measures lie: launch with `ignoreDefaultArgs: ["--hide-scrollbars"]`. A classic scrollbar takes 15 px.
- **A width floor must not depend on the font**: the Linux CI draws wider text (38 px of room against 111 px locally at 1280 px). Assert "one row" by height and keep any floor small (20 px) (SAG-263).
- The strict policy blocks `page.addStyleTag`: change a style with `style.setProperty`.
- The page behind a native modal `<dialog>` is inert, but Tab at its last control leaves the document and comes back: assert that focus never reaches the page behind, not that it stays in the dialog. A `<summary>` has no button role: find it by its label.
- `getByRole("link", { name: /sagas/i })` also matches the logo "SagaShelf": use `{ name: "Sagas", exact: true }`.
- **The rate limiters count per run** (`E2E_CALLER` in `playwright.config.ts`); `--repeat-each` above about 5 on the search tests shares one budget. More in `docs/architecture.md`, end-to-end section.
- **Beacons sent while a page unloads are invisible to Playwright.** Wrap `Blob` and `navigator.sendBeacon` in `page.addInitScript` and save the text synchronously in `localStorage`. The browser fires `pagehide` and then `visibilitychange` (hidden), and `web-vitals` gives its final CLS and INP in the second: ask for every change (`reportAllChanges: true`) and send at the first hide (SAG-254).
- **Brave sends Global Privacy Control by default**, so the tracker sends nothing there: test the analytics in Chrome, Edge or Firefox, signed out. To try `ANALYTICS_ENABLED` in dev, use a throwaway `.dev.vars` in a worktree and delete it after.
- Keyboard tests (`e2e/keyboard.spec.ts`): focus order is document order, a ring on every stop; the first stop of every page is the skip link (region `skip`).
