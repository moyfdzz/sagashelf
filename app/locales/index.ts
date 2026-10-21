import en from "./en.json";
import es from "./es.json";

/** Spanish is the default; English is selectable. */
export const supportedLanguages = ["es", "en"] as const;
export type Locale = (typeof supportedLanguages)[number];
export const fallbackLanguage: Locale = "es";

/** Each language is named in itself, so the selector is readable whatever the active language is. */
export const localeNames: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

// `es` is the source of truth: `en` must have exactly the same keys (checked by the compiler and by a test).
const english: typeof es = en;

export const resources = {
  es: { translation: es },
  en: { translation: english },
};

export function isLocale(value: unknown): value is Locale {
  return supportedLanguages.some((locale) => locale === value);
}
