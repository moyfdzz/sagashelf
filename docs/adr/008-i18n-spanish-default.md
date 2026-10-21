# ADR-008: Spanish by default, English selectable

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Done (SAG-8). The profile setting and the settings page are planned.
- **Tickets:** SAG-8, SAG-12, SAG-31

## Context

Adding a language later is expensive, and adding it at the start is cheap. The app is server rendered, so the language has to be known on the server for every request, before the HTML is produced. The ticket first proposed English as the default; the owner decided on 2026-10-20 that **Spanish is the default** and English is selectable.

## Decision

- **Languages:** Spanish (`es`, neutral Latin American Spanish, written to sound natural in Mexico) and English (`en`). The language code is `es`, so browsers asking for `es-MX`, `es-419` or `es-ES` are all recognized.
- **How the language is chosen, per request:** the `locale` cookie, then the browser's `Accept-Language`, then Spanish. A browser that asks for English gets English; Spanish is the final fallback for everything else. The user's saved profile language will go first once profiles exist (SAG-9, SAG-12); the place for it is marked in `app/middleware/i18next.ts`. A `?lng=` parameter in the URL is deliberately not used.
- **URLs do not change.** There is no `/es/` prefix, so there is nothing to localize in routes, and `hreflang` is not needed.
- **Library:** `remix-i18next` 8 with `i18next` and `react-i18next`. The server renders with the same i18next instance the middleware created, and the browser hydrates with the language the server wrote in `<html lang>`.
- **Messages:** `app/locales/es.json` is the source of truth and `en.json` must have exactly the same keys. Keys are typed, so an unknown key fails `npm run typecheck`. A test fails if a key, a `{{placeholder}}` or a language is missing or empty.
- **No hard-coded UI text.** An ESLint rule rejects literal text in components, including `aria-label`, `placeholder`, `alt` and `title`.
- **Selector:** a plain form in the header (no JavaScript needed) that posts to `/api/locale`. The route validates the language with Zod, accepts redirects only to paths inside the site, rejects requests from another origin, saves the cookie (one year, `SameSite=Lax`, `HttpOnly`, a preference cookie and not analytics), and returns to the same page. Changing the language reloads the page on purpose, so the server and the browser always agree.
- **Formats:** dates, numbers and relative times go through `Intl` helpers in `app/lib/format.ts`, with a fixed UTC time zone so the server and the browser print the same text while hydrating.
- **Caching:** HTML responses send `Vary: Cookie, Accept-Language`, so a shared cache keeps one copy per language.

## Alternatives considered

- **English as the default** (the original ticket). Wider audience for a portfolio, but the owner chose Spanish. Browsers set to English still receive English.
- **A language prefix in the URL (`/es/...`).** Good for search engines on content sites, but it duplicates every route and the ticket says it is not needed for an app. Revisit only if public pages are localized separately.
- **Detect the language in the browser only.** Would flash the wrong language on first paint and break server rendering. Rejected.
- **An i18n library without server integration.** More wiring and a higher chance of server and browser disagreeing. Rejected.

## Consequences

**Good**

- Missing translations fail the build, and untranslated text cannot be added by accident.
- The whole page, the title, `<html lang>`, and formats follow the chosen language.

**Costs and risks**

- The Worker grew from about 124 kB to about 187 kB compressed.
- `locale` is a cookie, so the privacy policy (SAG-31) must mention it.
- Media data in the user's language (TMDB `language` parameter, Wikidata labels) is not done; it belongs to each provider's ticket. The profile language and a language selector in settings wait for profiles and the settings page.
- If the library publishes a new major version, check that `createI18nextMiddleware` did not change.

## Open questions

- The Spanish wording needs a review by a native speaker. Adjust `es.json` where a phrase does not sound natural.

## References

- remix-i18next 8 documentation, <https://github.com/sergiodxa/remix-i18next> (read 2026-10-20)
- Ticket SAG-8 (Linear)
