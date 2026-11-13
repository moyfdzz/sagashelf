import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminStats from "./admin.stats";
import { resources } from "~/locales";

// The loader is tested in admin.stats.test.ts and the query on a real database; here only the page
// is drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/admin-overview", () => ({}));
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

const days = Array.from({ length: 30 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 14 + index)).toISOString().slice(0, 10),
  count: index === 29 ? 3 : index % 4,
}));

const props = () =>
  ({
    loaderData: {
      title: "Estadísticas",
      publishableKey: "pk_test_x",
      overview: {
        totalUsers: 1234,
        newToday: 3,
        newLast30Days: 45,
        newLast365Days: 600,
        activeLast7Days: 80,
        activeLast30Days: 210,
        entriesTracked: 9876,
        titlesTracked: 4321,
        signups: days,
      },
    },
  }) as unknown as Parameters<typeof AdminStats>[0];

describe("the statistics page of the administration (SAG-26)", () => {
  it("shows the main numbers with their names, in Spanish", async () => {
    const html = await render(<AdminStats {...props()} />);

    expect(html).toContain("Personas con cuenta");
    expect(html).toContain(">1234<");
    expect(html).toContain("Activas en 7 días");
    expect(html).toContain("Títulos en seguimiento");
    expect(html).toContain(">9876<");
  });

  it("is written in English too", async () => {
    const html = await render(<AdminStats {...props()} />, "en");

    expect(html).toContain("People with an account");
    expect(html).toContain("New accounts per day");
    expect(html).toContain("Show the numbers");
  });

  it("draws the chart of new accounts and a table with every day", async () => {
    const html = await render(<AdminStats {...props()} />);

    expect(html).toContain("<svg");
    expect(html).toContain("Cuentas nuevas por día");
    expect(html).toContain("<table");
    expect(html.match(/<tbody>.*<\/tbody>/s)?.[0].match(/<tr/g)).toHaveLength(
      30,
    );
  });

  it("tells a screen reader the whole date of each column, so a month change is clear", async () => {
    const html = await render(<AdminStats {...props()} />);

    expect(html).toMatch(/<svg[^>]*aria-label="14 oct 2026: 0, 15 oct 2026: 1/);
    expect(html).toMatch(/<dt [^>]*>Personas con cuenta<\/dt><dd/);
  });

  it("writes only some of the 30 day numbers under the chart, so they do not touch, and always the last", async () => {
    const html = await render(<AdminStats {...props()} />);
    const labels = [...html.matchAll(/y="182"[^>]*>(\d+)</g)].map(
      (match) => match[1],
    );

    expect(labels).toHaveLength(8);
    expect(labels.at(-1)).toBe("12");
    // Every day is still in the table, with its whole date.
    expect(html.match(/<tbody>.*<\/tbody>/s)?.[0].match(/<tr/g)).toHaveLength(
      30,
    );
  });

  it("has the sections of the statistics, with the overview as the current one", async () => {
    const html = await render(<AdminStats {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats"[^>]*aria-current="page"[^>]*>Resumen/,
    );
    expect(html).toMatch(/<a [^>]*href="\/admin\/stats\/traffic"[^>]*>Tráfico/);
  });

  it("marks the statistics tab as the current page of the administration", async () => {
    const html = await render(<AdminStats {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats"[^>]*aria-current="page"/,
    );
    expect(html).toMatch(/<a [^>]*href="\/admin\/sagas"/);
  });
});
