import i18next from "i18next";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { HydratedRouter } from "react-router/dom";

import { fallbackLanguage, resources, supportedLanguages } from "~/locales";

async function main() {
  await i18next.use(initReactI18next).init({
    resources,
    // The server decided the language and wrote it in <html lang>; hydrate with the same one.
    lng: document.documentElement.lang,
    fallbackLng: fallbackLanguage,
    supportedLngs: [...supportedLanguages],
    interpolation: { escapeValue: false },
  });

  startTransition(() => {
    hydrateRoot(
      document,
      <I18nextProvider i18n={i18next}>
        <StrictMode>
          <HydratedRouter />
        </StrictMode>
      </I18nextProvider>,
    );
  });
}

main().catch(console.error);
