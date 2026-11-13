import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminStatsTraffic from "./admin.stats.traffic";
import { resources } from "~/locales";

// The loader is tested in admin.stats.traffic.test.ts and the query on a real database; here only
// the page is drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/admin-traffic", () => ({}));
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

async function render(
  element: ReactNode,
  locale: "es" | "en" = "es",
): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter([{ path: "/", element }], {
    initialEntries: ["/"],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const row = (value: string, events: number) => ({
  value,
  events,
  visitors: events,
});

const perDay = Array.from({ length: 7 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 10, 5 + index)).toISOString().slice(0, 10),
  pageviews: index * 3,
  visits: index,
}));

const traffic = (fields: Record<string, unknown> = {}) => ({
  days: 7,
  from: "2026-11-05",
  to: "2026-11-11",
  rolledDays: 7,
  pageviews: 210,
  visits: 70,
  engagedMs: 70 * 90_000,
  funnel: [
    { kind: "pageview", count: 70 },
    { kind: "signup", count: 7 },
    { kind: "add_to_library", count: 4 },
    { kind: "follow", count: 0 },
  ],
  perDay,
  sources: [row("search", 30), row("direct", 20), row("weird", 1)],
  hosts: [row("google.com", 25), row("(other)", 5)],
  devices: [row("mobile", 40), row("desktop", 10)],
  pages: [row("/library", 90), row("(other)", 12)],
  ...fields,
});

const props = (fields: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Tráfico",
      publishableKey: "pk_test_x",
      traffic: traffic(fields),
      options: [7, 30, 90],
    },
  }) as unknown as Parameters<typeof AdminStatsTraffic>[0];

describe("the traffic page of the administration (SAG-26)", () => {
  it("shows the tiles, with the time per visit worked out from the totals", async () => {
    const html = await render(<AdminStatsTraffic {...props()} />);

    expect(html).toMatch(/<dt [^>]*>Páginas vistas<\/dt><dd [^>]*>210</);
    expect(html).toMatch(/<dt [^>]*>Visitas<\/dt><dd [^>]*>70</);
    expect(html).toMatch(/<dt [^>]*>Páginas por visita<\/dt><dd [^>]*>3</);
    expect(html).toContain("1.5");
  });

  it("names the sources and devices, and shows a value with no name of its own as it is", async () => {
    const html = await render(<AdminStatsTraffic {...props()} />);

    expect(html).toContain("Buscadores");
    expect(html).toContain("Directo");
    expect(html).toContain("weird");
    expect(html).toContain("Móvil");
    expect(html).toContain("Computadora");
    expect(html).toContain("google.com");
    expect(html).toContain("Otros");
  });

  it("gives the rest of the rollup a name in the sources and the devices", async () => {
    const html = await render(
      <AdminStatsTraffic
        {...props({
          sources: [row("search", 30), row("(other)", 4)],
          devices: [row("mobile", 40), row("(other)", 2)],
        })}
      />,
    );

    expect(html).not.toContain("(other)");
    expect(html).toContain("Otros");
  });

  it("draws the funnel with the rate of accounts for every 100 visits", async () => {
    const html = await render(<AdminStatsTraffic {...props()} />);

    expect(html).toContain("De la visita al registro");
    expect(html).toContain("Cuentas creadas");
    expect(html).toContain(
      "por cada 100 visitas (aproximado, porque una persona puede contar en varios días): 10.",
    );
  });

  it("offers the three windows as links and marks the current one", async () => {
    const html = await render(<AdminStatsTraffic {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/traffic\?days=7"[^>]*aria-current="page"[^>]*>7 días/,
    );
    expect(html).toMatch(/href="\/admin\/stats\/traffic\?days=30"/);
    expect(html).toMatch(/href="\/admin\/stats\/traffic\?days=90"/);
  });

  it("says when the nightly count has not done every day of the window", async () => {
    const full = await render(<AdminStatsTraffic {...props()} />);
    const partial = await render(
      <AdminStatsTraffic {...props({ rolledDays: 5 })} />,
    );

    expect(full).not.toContain("tienen datos");
    expect(partial).toContain("Solo 5 de 7 días tienen datos");
  });

  it("says there is no data, with no division by zero, for an empty period", async () => {
    const html = await render(
      <AdminStatsTraffic
        {...props({
          pageviews: 0,
          visits: 0,
          engagedMs: 0,
          sources: [],
          hosts: [],
          devices: [],
          pages: [],
          funnel: [
            { kind: "pageview", count: 0 },
            { kind: "signup", count: 0 },
            { kind: "add_to_library", count: 0 },
            { kind: "follow", count: 0 },
          ],
        })}
      />,
    );

    expect(html).toContain("Todavía no hay datos en este periodo.");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("por cada 100 visitas");
  });

  it("keeps real bars and a few readable labels for 90 days", async () => {
    const ninety = Array.from({ length: 90 }, (_, index) => ({
      day: new Date(Date.UTC(2026, 7, 14 + index)).toISOString().slice(0, 10),
      pageviews: index % 7,
      visits: 1,
    }));
    const html = await render(
      <AdminStatsTraffic {...props({ days: 90, perDay: ninety })} />,
    );
    const labels = [...html.matchAll(/y="182"[^>]*>(\d+)</g)];
    const widths = [...html.matchAll(/ a([\d.]+),/g)].map((m) => Number(m[1]));

    expect(labels.length).toBeLessThanOrEqual(9);
    expect(html).not.toContain("NaN");
    expect(html).not.toMatch(/ a-\d/);
    expect(widths.length).toBeGreaterThan(0);
  });

  it("draws the chart of each day with a table of the numbers", async () => {
    const html = await render(<AdminStatsTraffic {...props()} />);

    expect(html).toContain("<svg");
    expect(html).toContain("Mostrar los números");
    expect(html.match(/<tbody>.*?<\/tbody>/s)?.[0].match(/<tr/g)).toHaveLength(
      7,
    );
  });

  it("is written in English too, with the tab of the traffic as the current section", async () => {
    const html = await render(<AdminStatsTraffic {...props()} />, "en");

    expect(html).toContain("Page views per day");
    expect(html).toContain("Where they come from");
    expect(html).toContain("Search engines");
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/traffic"[^>]*aria-current="page"[^>]*>Traffic/,
    );
  });
});
