# ADR-013: Color palette "Marino y ámbar" and light or dark mode

- **Status:** Accepted
- **Date:** 2026-10-22
- **Implementation:** Done (in the SAG-12 branch)
- **Tickets:** SAG-12
- **Related:** [ADR-008](008-i18n-spanish-default.md), [ADR-011](011-edge-security-and-domain.md)

## Context

The first palette was one blue family with grays tinted blue. It was readable, but it had no character, it had no colors for messages (success, error), the edge of a form field was almost invisible, and it said nothing about what SagaShelf is: a place for stories in many formats. The product also needs a color for each content type (anime, series, movie, book, manga, custom) before the search and the library exist, and a way to switch to dark mode.

What the palette has to meet:

- Text and controls must pass WCAG contrast in both modes (4.5:1 for text, 7:1 for the main text, 3:1 for the edge of a control, WCAG 1.4.11).
- A content type is never told apart by color alone (WCAG 1.4.1): a label always goes with it.
- The content security policy forbids inline styles (ADR-011), so colors live in the stylesheet and not in `style` attributes.
- A page must not flash the wrong mode while it loads.

## Decision

- **Palette "Marino y ámbar".** A cool blue for actions and links on the page, a **navy header in both modes**, and amber as the brand color, **only inside the header** (the logo, the active link, the active language). The tokens are written in OKLCH in `app/app.css`, and components use only the semantic names (`bg-surface`, `text-fg`, `bg-accent`, ...). Inside `header[data-chrome]` the same class names take the header colors, so the components in it did not change.
- **A stronger color for the edge of a field** (`--input-edge`, 3.5:1 against the page). The divider color (`--border`) was 1.4:1 and stays only as a divider.
- **Colors for messages:** success (green) and danger (red), each with a background, a text color and an edge.
- **Colors for the content types:** anime 205°, series 270°, movie 350°, book 100°, manga 310°, and a neutral one for custom titles. Each has a tinted background, the text on it (7:1) and a dot. The hues were chosen so that every pair stays apart under protanopia, deuteranopia and tritanopia (a search over hue sets, scored by the smallest OKLab distance), and at least 32° from the green of a success and the red of an error. They are defined as tokens now and used when the search and the library exist.
- **Which mode the page shows:** first the mode the person chose with the switch in the header, then the system setting (`prefers-color-scheme`), and light when there is neither.
  - The choice is a cookie `theme` (a preference, like the language cookie), written by the switch with `document.cookie`. The root loader reads it and the server puts `data-theme` on `<html>`, so the first byte of the page is already in the right mode. With no cookie, no attribute is written and the CSS media query follows the system, so nobody sees a flash.
  - The switch is a `role="switch"` button. It starts from the choice, else from the system setting (read with `useSyncExternalStore`), and follows the system until a choice is made.
- **The dark colors are written twice** (once under the media query, once under `data-theme="dark"`), because a media query and an attribute cannot share a block. `app/palette.test.ts` fails if the two differ.
- **The header wraps on narrow phones.** With the switch it needs 410 px, and it overflowed on phones of 320 and 360 px. It now wraps and fits from 320 px.
- **A test of the palette** (`app/palette.test.ts`) computes the contrast of every pair that is used together, in both modes: text, hints, links, buttons, field edges, messages, the header and the label of each content type. A control check proves that it would catch a faint field edge.

## Alternatives considered

- **Other palettes, compared side by side** in light and dark with the real screens: the old blue, "Lámpara" (warm paper, amber), "Mar profundo" (teal), "Zafiro" (a brighter blue), "Azul noche" (a calmer blue with a light header) and "Medianoche" (the same navy without amber). "Marino y ámbar" was chosen for its identity (a lamp over shelves at night) and because blue and amber are complementary.
- **A red or orange-red accent ("Tinta y bermellón").** Rejected: a red "Save" button next to a red error message confuses what is an action and what is a problem.
- **Teal as the accent.** Rejected: it sits 10° from the color of the anime type, and the blue we had sits 10° from the series type.
- **`light-dark()` in CSS** to write each color once. Rejected for now: Tailwind 4 targets Safari 16.4 and newer, and `light-dark()` is not in all of those versions (this is from memory, not checked against a compatibility table). The duplication is guarded by a test instead.
- **`localStorage` for the choice.** Rejected: the server cannot read it, so a person who chose dark would see a flash of light on every load.
- **Always light, ignoring the system.** The first version of this change. Replaced because a person whose system is dark would see a white page first.
- **A third explicit option, "System".** Not added: following the system happens by itself until a choice is made, and that covers it with one control.

## Consequences

**Good**

- A palette with character, a safe contrast everywhere (checked by a test), visible field edges, and colors ready for the content types.
- No flash of the wrong mode, with or without a saved choice.
- A change of color is a change in one file, and a test says if it made something hard to read.

**Costs and risks**

- **Amber is a brand color and only that.** It is 18° from the book color and looks like a rating star or a warning. Ratings and warnings must use another color, or they will be mistaken for the brand.
- **Two accents** (amber in the header, blue on the page) work only if the rule is kept: the header is amber, the content is blue. A footer or a side menu would have to follow it.
- A navy header has more visual weight in light mode than a light one.
- The dark colors exist twice in the stylesheet (guarded by the test).
- The switch does nothing without JavaScript (the page still follows the system). For a person whose system is dark and who has made no choice, the server draws the light switch, and the browser corrects it right after load (the page colors are already right).

## Open questions

- **Clerk's own screens** (`/sign-in`, `/sign-up`) follow the mode (checked in a browser on 2026-10-22: with dark chosen, the card turns dark gray), but they use Clerk's neutral grays and a white primary button, not our navy and our blue. Clerk's `appearance` option can take our colors; not done yet.
- **Only Chromium was checked** (Playwright). Firefox and Safari were not tried, in particular for `oklch()` and `color-scheme`.
- **The color-vision simulation** used the Machado (2009) matrices written from memory, and the smallest distance between two types in the worst case is 0.04 in OKLab, which is modest. It was not tried with people who have a color-vision deficiency. The rule "always a label" is what makes it safe.
- The color of the header's amber against the color of the book type (18°) should be looked at again when the library draws both on one screen.

## Addendum: the logo (SAG-35, 2026-10-23)

- **The mark** is a book with an amber bookmark, with no text. The source is `public/favicon.svg` (navy tile, blue book, amber bookmark), which uses only the four colors of this palette (`app/brand.test.ts` checks it). It was drawn by hand as an SVG, after trying drafts from an image generator that did not follow the shapes asked for.
- **In the header** the same drawing is the component `app/components/LogoMark.tsx`. The book takes the header text color, not the blue, because blue on the navy header is only about 2:1; the bookmark takes the amber. It uses the header's color names, so the pairs of `app/palette.test.ts` already cover it (header text on header 7:1, amber on header 4.5:1). It is decoration (`aria-hidden`), because the name of the site is written next to it.
- **The files in `public/`:** `favicon.svg`, `favicon.ico` (16, 32 and 48 px), `apple-touch-icon.png` (180 px) and `icon-512.png`. The raster files are built from the SVG with `node scripts/build-icons.mjs` (Playwright). There is no web app manifest, because an installable app is not planned.
- **Google:** the logo is not uploaded to the OAuth consent screen, because Google asks for verification once a logo is there.

## References

- WCAG 2.2: contrast minimum (1.4.3), non-text contrast (1.4.11), use of color (1.4.1). Contrast ratios computed from the WCAG luminance formula in `app/palette.test.ts`.
- Local comparisons made on 2026-10-22 in a scratch branch, with screenshots in light and dark.
