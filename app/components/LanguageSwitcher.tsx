import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { localeNames, supportedLanguages } from "~/locales";

/**
 * A plain form (no JavaScript needed): it posts to /api/locale, which saves the
 * choice in a cookie and sends the visitor back to the page they were on.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { pathname, search } = useLocation();

  return (
    <form
      method="post"
      action="/api/locale"
      role="group"
      aria-label={t("language.label")}
      className="flex gap-1"
    >
      <input type="hidden" name="redirectTo" value={`${pathname}${search}`} />
      {supportedLanguages.map((locale) => (
        <button
          key={locale}
          type="submit"
          name="locale"
          value={locale}
          lang={locale}
          aria-pressed={i18n.language === locale}
          className={`rounded-md px-2 py-1 text-sm font-semibold transition-colors ${
            i18n.language === locale
              ? "bg-accent text-accent-fg"
              : "text-fg-muted hover:text-accent"
          }`}
        >
          {localeNames[locale]}
        </button>
      ))}
    </form>
  );
}
