import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminStatsWebhooks from "./admin.stats.webhooks";
import { resources } from "~/locales";

// The loader is tested in admin.stats.webhooks.test.ts and the query on a real database; here only
// the page is drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/admin-webhooks", () => ({}));
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

const perDay = Array.from({ length: 7 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 10, 6 + index)).toISOString().slice(0, 10),
  attempts: index,
  failed: index % 2,
}));

const webhooks = (fields: Record<string, unknown> = {}) => ({
  days: 7,
  from: "2026-11-06",
  to: "2026-11-12",
  clerk: {
    processed: 12,
    rejected: [
      { reason: "taken", count: 2 },
      { reason: "made_up", count: 1 },
    ],
  },
  attempts: {
    ok: 8,
    client_error: 1,
    server_error: 1,
    no_response: 0,
    other: 0,
  },
  latencyAvgMs: 250,
  latencyP95Ms: 900,
  events: { pending: 1, delivered: 7, failed: 2 },
  pendingNow: 3,
  endpoints: {
    total: 5,
    enabled: 3,
    disabled: [
      { reason: "unauthorized", count: 1 },
      { reason: "mystery", count: 1 },
    ],
  },
  perDay,
  ...fields,
});

const props = (fields: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Webhooks",
      publishableKey: "pk_test_x",
      webhooks: webhooks(fields),
      options: [7, 30],
    },
  }) as unknown as Parameters<typeof AdminStatsWebhooks>[0];

describe("the webhooks page of the administration (SAG-26)", () => {
  it("shows the tiles: events of Clerk, accounts refused, attempts and failed attempts", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />);

    expect(html).toMatch(/<dt [^>]*>Eventos de Clerk<\/dt><dd [^>]*>12</);
    expect(html).toMatch(/<dt [^>]*>Cuentas rechazadas<\/dt><dd [^>]*>3</);
    expect(html).toMatch(/<dt [^>]*>Intentos de entrega<\/dt><dd [^>]*>10</);
    expect(html).toMatch(/<dt [^>]*>Intentos fallidos<\/dt><dd [^>]*>2</);
  });

  it("names the reasons for a refusal and for an endpoint being off, and shows an unknown one as it is", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />);

    expect(html).toContain("Nombre o correo ya usado");
    expect(html).toContain("made_up");
    expect(html).toContain("Apagado: sin permiso (401 o 403)");
    expect(html).toContain("mystery");
  });

  it("says what the endpoints answered, the time they took, and the notices that wait", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />);

    expect(html).toContain("Bien (2xx)");
    expect(html).toContain("Falla del otro lado (5xx)");
    expect(html).toMatch(/250\smilisegundos|250\sms/);
    expect(html).toContain("Ahora esperan 3 avisos");
    expect(html).toContain("Esperando");
    expect(html).toContain("Se rindió");
  });

  it("says that repeated events are not counted", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />);

    expect(html).toContain("Los eventos repetidos");
  });

  it("says there is nothing, with no time and no NaN, for an empty period", async () => {
    const html = await render(
      <AdminStatsWebhooks
        {...props({
          clerk: { processed: 0, rejected: [] },
          attempts: {
            ok: 0,
            client_error: 0,
            server_error: 0,
            no_response: 0,
            other: 0,
          },
          latencyAvgMs: null,
          latencyP95Ms: null,
          events: { pending: 0, delivered: 0, failed: 0 },
          pendingNow: 0,
          endpoints: { total: 0, enabled: 0, disabled: [] },
        })}
      />,
    );

    expect(html).toContain("Ninguna cuenta rechazada en el periodo.");
    expect(html).toContain("Todavía no hay datos en este periodo.");
    expect(html).not.toContain("Tiempo de respuesta");
    expect(html).not.toContain("NaN");
  });

  it("draws the failed attempts per day with a table of every day", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />);

    expect(html).toContain("Intentos fallidos por día");
    expect(html).toContain("Mostrar los números");
    expect(html.match(/<tbody>.*?<\/tbody>/s)?.[0].match(/<tr/g)).toHaveLength(
      7,
    );
  });

  it("offers the two windows and has the webhooks tab as the current section", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/webhooks\?days=7"[^>]*aria-current="page"/,
    );
    expect(html).toMatch(/href="\/admin\/stats\/webhooks\?days=30"/);
    expect(html).not.toMatch(/days=90/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/webhooks"[^>]*aria-current="page"[^>]*>Webhooks/,
    );
  });

  it("is written in English too", async () => {
    const html = await render(<AdminStatsWebhooks {...props()} />, "en");

    expect(html).toContain("What Clerk sends");
    expect(html).toContain("What we deliver");
    expect(html).toContain("Failed attempts per day");
    expect(html).toContain("3 notices are waiting now");
  });
});
