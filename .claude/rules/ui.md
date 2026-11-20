---
paths:
  - "app/components/**"
  - "app/lib/**"
  - "app/locales/**"
  - "app/routes/**/*.tsx"
  - "app/root.tsx"
  - "app/app.css"
---

# UI rules

- **All visible text** goes in `app/locales/es.json` (source of truth, neutral Latin American Spanish, natural in Mexico) and `en.json` with the same keys, through `t("...")`. Typed keys: a list typed `string[]` breaks a key built from a template string, so keep the literal union. Plurals use `_one`/`_other`; a `count` parameter picks the plural. Dates, numbers and lists go through `app/lib/format.ts`.
- **ESLint traps:** `jsx-no-literals` (also a literal empty `alt`), `no-restricted-imports` (no `react-dom/server` and no `~server/*` under `app/components` and `app/lib`; no `~/*` under `server/`), `no-unused-vars`, `no-control-regex`, `jsx-a11y/*`, `no-non-null-assertion`, `no-useless-escape`, `no-irregular-whitespace`.
- **What is pressed lives in `app/lib/ui.ts`** (`primaryButtonClass`, `secondaryButtonClass`, `dangerButtonClass`, `smallButtonClass`, `secondaryLinkClass`, `tabClass`, `linkClass`, `textLinkClass`): use them.
- **Every control is 40 px high** (SAG-258): `linkClass`, `tabClass`, `segmentClass`, the buttons and icon buttons carry `min-h-10` or `size-10`. Do not put `block` or `inline-block` next to `linkClass` (its `inline-flex` wins) and do not add padding to make it taller. A link inside a sentence (`textLinkClass`) is exempt (WCAG 2.2, 2.5.8). A checkbox whose label is a sibling needs the label at 40 px (`inline-block py-2`) and the box moved down with `mt-3`.
- **A flex link needs `overflow-wrap: anywhere`** (in `linkClass`): in a flex box `break-words` does not shrink the min-content width, and a long username ran 212 px out of a 320 px page. A very long unbroken string elsewhere needs `break-all` or `break-words`.
- **Tailwind generates only classes it can read whole in the code**: never build a class name from pieces.
- **A component of the root layout is mounted again on a client navigation** (SAG-24): state kept in it or in a `useRef` is lost. Anything that must live for the whole document is a module-level singleton started from an effect.
- **The skip link** (SAG-256) is the first thing in the `body` of `app/root.tsx`; it points to `<div id="content" tabIndex={-1}>` (`contentId` in `app/lib/skip.ts`). A new layout keeps that `id` (`app/skip-link.test.ts`, `e2e/skip-link.spec.ts`). It is `sr-only`: a test presses Tab and Enter.
- **The header:** changing the logo size also needs `e2e/navigation.spec.ts` (a floor of 130 px for its width) and `header.render.test.tsx`; run both `reflow.spec.ts` and `navigation.spec.ts` before pushing. To know whether the header fits on one row, draw it with `renderToString` for a made-up signed-in person (unread 0, 5 and 150, `es` and `en`, with and without the administration), load it in Chromium with the CSS of the build and bisect the narrowest width where the bar is under 90 px high; compare with `main` (SAG-261).
- **Look at what you build.** Render the page to static HTML and measure it with Playwright at 320, 390 and 1280 px, light and dark, both languages (`scrollWidth` against `clientWidth`, controls at least 40 px), and take a screenshot. For behavior with JavaScript (a modal, focus, Escape) bundle the component alone with `esbuild` and drive it in Chromium (it found a real bug in the modal).
- **Render tests with numbers in Spanish:** `Intl` does not group 4-digit numbers (`1234`), writes a percent as `75 %` with a thin space, and uses a comma for decimals (`8,5`). Assert on the element (`<dt>..</dt><dd>..`), not loose text: `"1.5"` matched the class `py-1.5`.
- **Do not look for a state in a class name**: `toContain("disabled")` also matches the `disabled:` variant; check the attribute (`disabled=""`).
- The base of every page is about 176 KB of gzipped JavaScript: a new dependency in the root shows in all of them (`performance-budgets.json`).
