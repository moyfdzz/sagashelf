import { createInstance } from "i18next";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";

import { SkipLink } from "~/components/SkipLink";
import { contentId } from "~/lib/skip";
import { resources } from "~/locales";

async function render(locale: "es" | "en"): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <SkipLink />
    </I18nextProvider>,
  );
}

describe("the skip link (SAG-256)", () => {
  it("is a plain anchor to the content, in both languages", async () => {
    const es = await render("es");
    const en = await render("en");

    expect(es).toMatch(new RegExp(`<a [^>]*href="#${contentId}"[^>]*>`));
    expect(es).toContain("Saltar al contenido");
    expect(en).toContain("Skip to content");
    expect(en).toMatch(new RegExp(`href="#${contentId}"`));
  });

  it("is hidden until it has the focus, and then hangs over the page without moving it", async () => {
    const html = await render("es");
    const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");

    expect(classes).toContain("sr-only");
    expect(classes).toContain("focus:not-sr-only");
    // Fixed, so showing it moves nothing, and above the header.
    expect(classes).toContain("focus:fixed");
    expect(classes).toContain("focus:z-50");
    // The colors of the buttons, whose contrast is tested, and a ring like the other controls.
    expect(classes).toContain("bg-accent");
    expect(classes).toContain("text-accent-fg");
    expect(classes).toContain("focus-visible:outline-2");
  });
});
