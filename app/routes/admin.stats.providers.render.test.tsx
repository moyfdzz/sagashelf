import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminStatsProviders from "./admin.stats.providers";
import { resources } from "~/locales";

// The loader is tested in admin.stats.providers.test.ts and the query on a real database; here only
// the page is drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/admin-providers", () => ({}));
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

const outcomes = (fields: Record<string, number> = {}) => ({
  ok: 0,
  http_4xx: 0,
  http_429: 0,
  http_5xx: 0,
  http_other: 0,
  timeout: 0,
  network: 0,
  invalid: 0,
  rate_limited: 0,
  circuit_open: 0,
  cancelled: 0,
  ...fields,
});

const perDay = Array.from({ length: 7 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 10, 6 + index)).toISOString().slice(0, 10),
  calls: index * 2,
  failed: index % 2,
}));

const providers = (fields: Record<string, unknown> = {}) => ({
  days: 7,
  from: "2026-11-06",
  to: "2026-11-12",
  startedOn: "2026-10-01",
  totals: {
    calls: 20,
    failed: 5,
    requests: 24,
    latencyAvgMs: 320,
    outcomes: outcomes({ ok: 15, http_5xx: 1, timeout: 2, circuit_open: 2 }),
  },
  providers: [
    {
      provider: "tmdb",
      calls: 15,
      failed: 4,
      stopped: 2,
      requests: 18,
      peakDayRequests: 9,
      latencyAvgMs: 250,
      outcomes: outcomes({ ok: 11, timeout: 2, circuit_open: 2 }),
    },
    {
      provider: "newcomer",
      calls: 5,
      failed: 1,
      stopped: 0,
      requests: 6,
      peakDayRequests: 4,
      latencyAvgMs: null,
      outcomes: outcomes({ ok: 4, http_5xx: 1 }),
    },
  ],
  perDay,
  ...fields,
});

const props = (fields: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Proveedores",
      publishableKey: "pk_test_x",
      providers: providers(fields),
      options: [7, 30, 90],
    },
  }) as unknown as Parameters<typeof AdminStatsProviders>[0];

describe("the providers page of the administration (SAG-26)", () => {
  it("shows the tiles: calls, the share that failed, the average time and the requests", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);

    expect(html).toMatch(/<dt [^>]*>Llamadas<\/dt><dd [^>]*>20</);
    expect(html).toMatch(/<dt [^>]*>Llamadas fallidas<\/dt><dd [^>]*>25\s%</);
    expect(html).toMatch(/<dt [^>]*>Peticiones enviadas<\/dt><dd [^>]*>24</);
    expect(html).toMatch(/<dt [^>]*>Tiempo promedio<\/dt><dd [^>]*>320\s/);
  });

  it("has a card for each provider, with its name as the site writes it and its own numbers", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);
    const cards = html.match(/<li [^>]*rounded-md[^>]*>.*?<\/li>/gs) ?? [];

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatch(/<h4 [^>]*>TMDB<\/h4>/);
    expect(cards[0]).toMatch(/<dt [^>]*>Llamadas<\/dt><dd [^>]*>15</);
    expect(cards[0]).toMatch(
      /<dt [^>]*>Día con más peticiones<\/dt><dd [^>]*>9</,
    );
    expect(cards[0]).toMatch(/<dd [^>]*>27\s%</);
    expect(cards[1]).toMatch(/<h4 [^>]*>newcomer<\/h4>/);
    expect(cards[1]).toContain("Sin datos");
  });

  it("says there is no average time for a provider that has none, with no NaN", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);

    expect(html).toContain("Sin datos");
    expect(html).not.toContain("NaN");
  });

  it("names every way a call ends, in the bar", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);

    expect(html).toContain("Cómo terminaron las llamadas");
    expect(html).toContain("Bien");
    expect(html).toContain("Falla del proveedor (5xx)");
    expect(html).toContain("Detenida: proveedor en pausa");
  });

  it("says that the numbers are approximate and that a cache and a quota are not measured", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);

    expect(html).toContain("Los números son aproximados");
    expect(html).toContain("caché no se mide");
  });

  it("says the counts start late, only when they do, and when nothing was counted at all", async () => {
    const early = await render(<AdminStatsProviders {...props()} />);
    const late = await render(
      <AdminStatsProviders {...props({ startedOn: "2026-11-09" })} />,
    );
    const never = await render(
      <AdminStatsProviders
        {...props({
          startedOn: null,
          providers: [],
          totals: {
            calls: 0,
            failed: 0,
            requests: 0,
            latencyAvgMs: null,
            outcomes: outcomes(),
          },
        })}
      />,
    );

    expect(early).not.toContain("Los conteos empiezan");
    expect(late).toContain("Los conteos empiezan el 9 nov 2026");
    expect(never).toContain("Todavía no se ha contado ninguna llamada.");
    expect(never).toContain("Todavía no hay datos en este periodo.");
    expect(never).not.toContain("NaN");
  });

  it("draws the failed calls per day with a table of every day", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);

    expect(html).toContain("Llamadas fallidas por día");
    expect(html).toContain("Mostrar los números");
    expect(
      html
        .match(/<tbody>.*?<\/tbody>/gs)
        ?.at(-1)
        ?.match(/<tr/g),
    ).toHaveLength(7);
  });

  it("offers the three windows and has the providers tab as the current section", async () => {
    const html = await render(<AdminStatsProviders {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/providers\?days=7"[^>]*aria-current="page"/,
    );
    expect(html).toMatch(/href="\/admin\/stats\/providers\?days=90"/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/providers"[^>]*aria-current="page"[^>]*>Proveedores/,
    );
  });

  it("is written in English too", async () => {
    const html = await render(<AdminStatsProviders {...props()} />, "en");

    expect(html).toContain("How the calls ended");
    expect(html).toContain("Failed calls per day");
    expect(html).toContain("The numbers are approximate");
    expect(html).toContain("Stopped: provider paused");
  });
});
