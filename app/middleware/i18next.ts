import { initReactI18next } from "react-i18next";
import { createCookie } from "react-router";
import { createI18nextMiddleware } from "remix-i18next";

import { fallbackLanguage, resources, supportedLanguages } from "~/locales";

/** Remembers the language the visitor picked. A preference cookie, not analytics. */
export const localeCookie = createCookie("locale", {
  path: "/",
  sameSite: "lax",
  secure: import.meta.env.PROD,
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
});

// Order: cookie, then the browser's Accept-Language, then Spanish. The user's
// saved profile language goes first (via `findLocale` and the "custom" order)
// once profiles exist. `?lng=` in the URL is deliberately not used.
export const [i18nextMiddleware, getLocale, getInstance] =
  createI18nextMiddleware({
    detection: {
      supportedLanguages: [...supportedLanguages],
      fallbackLanguage,
      cookie: localeCookie,
      order: ["cookie", "header"],
    },
    i18next: {
      resources,
      fallbackLng: fallbackLanguage,
      supportedLngs: [...supportedLanguages],
      // React already escapes what it renders.
      interpolation: { escapeValue: false },
    },
    plugins: [initReactI18next],
  });
