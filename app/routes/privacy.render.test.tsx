import { getTableColumns } from "drizzle-orm";
import { createInstance } from "i18next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import Privacy from "./privacy";
import { resources } from "~/locales";
import { analyticsRetentionMonths } from "../../server/db/analytics-rollup";
import {
  analyticsDaily,
  analyticsEvents,
  analyticsVitalsDaily,
} from "../../server/db/schema/analytics";

async function render(locale: "es" | "en"): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter([{ path: "/", element: <Privacy /> }], {
    initialEntries: ["/"],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

/** The text of the page, without tags, so a phrase can be looked for in one piece. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

describe("the privacy policy says what the analytics measure (SAG-24)", () => {
  it("has a section of its own, with what is measured and what is not, in Spanish", async () => {
    const html = await render("es");
    const text = textOf(html);

    expect(html).toContain('id="stats"');
    // The line in the list of data leads to the section.
    expect(html).toMatch(/<a [^>]*href="#stats"[^>]*>[^<]*Estadísticas de uso/);
    expect(text).toContain("Estadísticas de uso");
    expect(text).toContain("sistema propio");
    expect(text).toContain("No usa cookies");
    expect(text).toContain("El tipo de cada búsqueda");
    expect(text).toContain("nunca el texto que escribes");
    expect(text).toContain("Tu país y tu región (no tu ciudad)");
    expect(text).toContain("No guardamos tu dirección IP");
    expect(text).toContain(
      "el código no sirve para reconocerte de un día a otro",
    );
    expect(text).toContain("«No rastrear» (Do Not Track)");
    expect(text).toContain("Control Global de Privacidad (GPC)");
  });

  it("says the same in English", async () => {
    const text = textOf(await render("en"));

    expect(text).toContain("Usage statistics");
    expect(text).toContain("our own system");
    expect(text).toContain("It uses no cookies");
    expect(text).toContain("never the text you type");
    expect(text).toContain("country and region (not your city)");
    expect(text).toContain("We do not store your IP address");
    expect(text).toContain(
      "cannot be used to recognize you from one day to the next",
    );
    expect(text).toContain("“Do Not Track” signal");
    expect(text).toContain("Global Privacy Control (GPC)");
  });

  it("no longer talks about Cloudflare Web Analytics, which is turned off", async () => {
    for (const locale of ["es", "en"] as const) {
      const text = textOf(await render(locale));
      expect(text, locale).not.toContain("Web Analytics");
      expect(text, locale).not.toContain("Cloudflare Web");
    }
  });

  it("says the speed of the pages is measured, and for which page", async () => {
    const es = textOf(await render("es"));
    const en = textOf(await render("en"));

    expect(es).toContain("Qué tan rápido carga y responde cada página");
    expect(es).toContain("la página con la que empezó tu visita");
    expect(en).toContain("How fast each page loads and responds");
    expect(en).toContain("the page your visit started on");
  });

  it("still says Cloudflare gives the country and the region, and Neon keeps the statistics", async () => {
    const es = textOf(await render("es"));
    const en = textOf(await render("en"));

    expect(es).toContain("nos indica el país y la región de cada visita");
    expect(es).toContain("tu perfil y las estadísticas de uso");
    expect(en).toContain("tells us the country and region of each visit");
    expect(en).toContain("your profile and the usage statistics");
  });

  it("gives the time the raw events are kept as the code keeps them", async () => {
    const months = String(analyticsRetentionMonths);

    expect(textOf(await render("es"))).toContain(
      `se conservan ${months} meses`,
    );
    expect(textOf(await render("en"))).toContain(`kept for ${months} months`);
  });
});

describe("what the policy promises is what the code does", () => {
  it("stores no address, city, user, browser name or search text in the events", () => {
    const columns = Object.values(getTableColumns(analyticsEvents)).map(
      (column) => column.name,
    );

    for (const forbidden of [
      "ip",
      "ip_address",
      "city",
      "user_id",
      "user_agent",
      "query",
      "search_text",
    ]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
    // And does store the country and the region, which the policy says.
    expect(columns).toEqual(expect.arrayContaining(["country", "region"]));
  });

  it("keeps no visitor code in the totals that are kept with no time limit", () => {
    const columns = Object.values(getTableColumns(analyticsDaily)).map(
      (column) => column.name,
    );

    expect(columns).not.toContain("visitor");
    expect(columns.sort()).toEqual(
      ["day", "dimension", "engaged_ms", "events", "value", "visitors"].sort(),
    );
  });

  it("keeps no visitor code in the totals of the speed of the pages either", () => {
    const columns = Object.values(getTableColumns(analyticsVitalsDaily)).map(
      (column) => column.name,
    );

    expect(columns).not.toContain("visitor");
    expect(columns.sort()).toEqual(
      [
        "day",
        "good",
        "metric",
        "needs_improvement",
        "p75",
        "page",
        "poor",
        "samples",
      ].sort(),
    );
  });

  it("stores the speed as three numbers of one load, which is what the policy says is measured", () => {
    const columns = Object.values(getTableColumns(analyticsEvents)).map(
      (column) => column.name,
    );

    expect(columns).toEqual(
      expect.arrayContaining(["lcp_ms", "cls", "inp_ms"]),
    );
  });

  it("uses no cookie and no storage of the browser to measure", () => {
    for (const file of ["app/components/Analytics.tsx", "app/lib/tracker.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const storage of [
        "document.cookie",
        "localStorage",
        "sessionStorage",
        "indexedDB",
      ]) {
        expect(source, `${file} uses ${storage}`).not.toContain(storage);
      }
    }
  });
});
