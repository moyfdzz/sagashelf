import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import NotificationSettings from "./settings.notifications";
import { resources } from "~/locales";
import { fakeWebhookId, fakeWebhookToken } from "~server/testing/discord";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/webhooks", () => ({}));
vi.mock("~server/jobs/deliver-outbox", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => children,
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

const masked = `https://discord.com/api/webhooks/${fakeWebhookId}/…${fakeWebhookToken.slice(-4)}`;
const endpointId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const on = {
  id: endpointId,
  maskedUrl: masked,
  enabled: true,
  disabledAt: null,
  disabledReason: null,
  episodeAlerts: false,
};
const off = {
  id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
  maskedUrl: masked,
  enabled: false,
  disabledAt: "2026-11-02T12:30:00.000Z",
  disabledReason: "not_found",
  episodeAlerts: false,
};

const props = (loader: Record<string, unknown> = {}, actionData?: unknown) =>
  ({
    loaderData: {
      title: "Notificaciones | SagaShelf",
      publishableKey: "publishable-key-for-tests",
      enabled: true,
      max: 3,
      endpoints: [],
      deliveries: [],
      ...loader,
    },
    actionData,
  }) as unknown as Parameters<typeof NotificationSettings>[0];

const page = (loader?: Record<string, unknown>, actionData?: unknown) => (
  <NotificationSettings {...props(loader, actionData)} />
);

describe("the notifications page (SAG-27)", () => {
  it("explains how to make a webhook, warns who will read the channel, and asks for the address", async () => {
    const html = await render(page());

    expect(html).toContain("Notificaciones");
    expect(html).toContain("Conectar un canal de Discord");
    expect(html).toContain("Integraciones y luego a Webhooks");
    expect(html).toContain("cualquiera que pueda leer ese canal");
    expect(html).toContain("crea tu propio servidor");
    expect(html).toContain("Quien tenga la URL puede publicar en ese canal");
    expect(html).toContain('name="intent" value="add"');
    expect(html).toMatch(
      /<label [^>]*for="webhook-url"[^>]*>URL del webhook<\/label>/,
    );
    expect(html).toContain("Empieza con https://discord.com/api/webhooks/");
  });

  it("asks for the address without letting the browser keep it or correct it", async () => {
    const html = await render(page());
    const input = html.match(/<input [^>]*id="webhook-url"[^>]*>/)?.[0] ?? "";

    expect(input).toContain('autoComplete="off"');
    expect(input).toContain('spellCheck="false"');
    expect(input).toContain("required");
    expect(input).toContain('name="url"');
  });

  it("says there is no webhook yet, and no delivery", async () => {
    const html = await render(page());

    expect(html).toContain("Todavía no has conectado ningún canal");
    expect(html).toContain("Todavía no hay envíos");
    expect(html).toContain(
      "Sin ninguno marcado, solo se envía el mensaje de prueba",
    );
  });

  it("lists a webhook with the masked address, and a button to test it and one to remove it", async () => {
    const html = await render(page({ endpoints: [on] }));

    expect(html).toContain(masked);
    expect(html).toContain("Activo");
    expect(html).toContain("Enviar mensaje de prueba");
    expect(html).toContain('name="intent" value="test"');
    expect(html).toContain(`name="id" value="${endpointId}"`);
    expect(html).toContain('name="intent" value="remove"');
    // The button that removes says which one it removes, for somebody who cannot see the page.
    expect(html).toContain(`aria-label="Quitar el webhook ${masked}"`);
  });

  describe("the alerts of new episodes (SAG-28)", () => {
    const box = (html: string) =>
      html.match(/<input [^>]*name="episodes"[^>]*>/)?.[0] ?? "";

    it("offers a box for each webhook, with a label that names it and a hint that goes with it", async () => {
      const html = await render(page({ endpoints: [on] }));

      expect(html).toContain('name="intent" value="alerts"');
      expect(html).toContain(`name="id" value="${endpointId}"`);
      expect(html).toContain("Avisos de este canal");
      expect(box(html)).toContain('type="checkbox"');
      expect(box(html)).toContain(`id="episodes-${endpointId}"`);
      expect(box(html)).toContain(
        `aria-describedby="episodes-hint-${endpointId}"`,
      );
      expect(html).toMatch(
        new RegExp(
          `<label [^>]*for="episodes-${endpointId}"[^>]*>Episodios nuevos de lo que estás viendo</label>`,
        ),
      );
      expect(html).toContain(`id="episodes-hint-${endpointId}"`);
      expect(html).toContain("hasta una hora después");
      expect(html).toContain("Guardar avisos");
    });

    it("has the box unticked until the person ticks it, and ticked once they have", async () => {
      const unticked = await render(page({ endpoints: [on] }));
      const ticked = await render(
        page({ endpoints: [{ ...on, episodeAlerts: true }] }),
      );

      expect(box(unticked)).not.toContain("checked");
      expect(box(ticked)).toContain("checked");
    });

    it("gives each webhook its own box, so two labels never point at the same one", async () => {
      const html = await render(page({ endpoints: [on, off] }));
      const ids = [...html.matchAll(/<input [^>]*name="episodes"[^>]*>/g)].map(
        (match) => match[0].match(/ id="([^"]+)"/)?.[1],
      );

      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    });

    it("says the same in English", async () => {
      const html = await render(page({ endpoints: [on] }), "en");

      expect(html).toContain("Alerts for this channel");
      expect(html).toContain("New episodes of what you are watching");
      expect(html).toContain("up to an hour after it comes out");
      expect(html).toContain("Save alerts");
    });
  });

  it("draws the three buttons of a webhook the same size, with the one that removes in the danger colors (SAG-98)", async () => {
    const html = await render(page({ endpoints: [on, off] }));
    const buttonClasses = (label: string) =>
      [...html.matchAll(/<button ([^>]*)>([^<]*)<\/button>/g)]
        .filter((match) => match[2]?.includes(label))
        .map((match) => match[1]?.match(/class="([^"]*)"/)?.[1] ?? "");
    const size = (classes: string) =>
      classes
        .split(" ")
        .filter((token) => /^(px|py)-/.test(token))
        .sort()
        .join(" ");

    const test = buttonClasses("Enviar mensaje de prueba");
    const enable = buttonClasses("Reactivar");
    const remove = buttonClasses("Quitar");

    expect(test).toHaveLength(1);
    expect(enable).toHaveLength(1);
    expect(remove).toHaveLength(2);
    // Every button has the padding of the test button: none is smaller than the others.
    for (const classes of [...enable, ...remove]) {
      expect(size(classes)).toBe(size(test[0] ?? ""));
      expect(size(classes)).toBe("px-4 py-2");
    }
    for (const classes of remove) {
      expect(classes).toContain("border-danger-edge");
      expect(classes).toContain("text-danger-fg");
      expect(classes).not.toContain("text-sm");
    }
    // The ones that are not for deleting are not in the danger colors.
    expect(test[0]).not.toContain("danger");
    expect(enable[0]).not.toContain("danger");
  });

  it("never has the token in the page, only its last characters", async () => {
    const html = await render(
      page({
        endpoints: [on],
        deliveries: [
          {
            id: "d1",
            endpointId,
            type: "webhook.test",
            attempt: 1,
            statusCode: 204,
            latencyMs: 80,
            error: null,
            createdAt: "2026-11-02T11:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).not.toContain(fakeWebhookToken);
    expect(html).toContain(fakeWebhookToken.slice(-4));
  });

  it("says why a webhook is off and since when, and offers to turn it back on instead of testing it", async () => {
    const html = await render(page({ endpoints: [off] }));

    expect(html).toContain("Desactivado");
    expect(html).toContain("Ese webhook ya no existe en Discord");
    expect(html).toContain("Se desactivó el 2 nov 2026, 12:30");
    expect(html).toContain("Reactivar");
    expect(html).toContain('name="intent" value="enable"');
    expect(html).not.toContain("Enviar mensaje de prueba");
  });

  it.each([
    ["unauthorized", "Discord rechazó la URL"],
    ["not_found", "ya no existe en Discord"],
    ["too_many_failures", "Falló varias veces seguidas"],
  ])("has a text for the reason %s", async (reason, text) => {
    const html = await render(
      page({ endpoints: [{ ...off, disabledReason: reason }] }),
    );

    expect(html).toContain(text);
  });

  it("lists the latest deliveries, delivered or not, with the answer and the time it took", async () => {
    const html = await render(
      page({
        endpoints: [on],
        deliveries: [
          {
            id: "d1",
            endpointId,
            type: "webhook.test",
            attempt: 1,
            statusCode: 204,
            latencyMs: 80,
            error: null,
            createdAt: "2026-11-02T11:00:00.000Z",
          },
          {
            id: "d2",
            endpointId,
            type: "webhook.test",
            attempt: 2,
            statusCode: 502,
            latencyMs: 30,
            error: "http_502",
            createdAt: "2026-11-02T10:00:00.000Z",
          },
          {
            id: "d3",
            endpointId,
            type: "webhook.test",
            attempt: 3,
            statusCode: null,
            latencyMs: null,
            error: "timeout",
            createdAt: "2026-11-02T09:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("Entregado");
    expect(html.match(/No entregado/g)).toHaveLength(2);
    expect(html).toContain("Intento 1 · respuesta 204 · 80 ms");
    expect(html).toContain("Intento 2 · respuesta 502 · 30 ms");
    expect(html).toContain("Intento 3 · respuesta timeout · 0 ms");
    expect(html).toContain("Las horas están en UTC");
  });

  it("lets a long address break in the list of endpoints and in the log, so it never widens the page on a phone", async () => {
    const html = await render(
      page({
        endpoints: [on],
        deliveries: [
          {
            id: "d1",
            endpointId,
            type: "webhook.test",
            attempt: 1,
            statusCode: 204,
            latencyMs: 80,
            error: null,
            createdAt: "2026-11-02T11:00:00.000Z",
          },
        ],
      }),
    );
    // The tag that opens right before each place the address is written.
    const tags: string[] = [];
    for (let from = 0; ;) {
      const at = html.indexOf(masked, from);
      if (at === -1) break;
      tags.push(html.slice(html.lastIndexOf("<", at), at));
      from = at + masked.length;
    }

    // The address is written in text twice (the endpoint and its delivery), and both can break
    // anywhere. A third place, the label of the button that removes it, is not text on the page.
    const written = tags.filter(
      (tag) => tag.startsWith("<p ") || tag.startsWith("<span "),
    );
    expect(written).toHaveLength(2);
    for (const tag of written) expect(tag).toContain("break-all");
  });

  it("shows only that the webhooks are not available when they are off", async () => {
    const html = await render(page({ enabled: false }));

    expect(html).toContain("todavía no están disponibles en este servidor");
    expect(html).not.toContain('name="intent"');
    expect(html).not.toContain("Conectar un canal de Discord");
  });

  it("does not let a person add a webhook once they have the most they may have", async () => {
    const html = await render(
      page({ max: 2, endpoints: [on, { ...on, id: "other" }] }),
    );
    const button =
      html.match(
        /<button [^>]*type="submit"[^>]*>Guardar webhook<\/button>/,
      )?.[0] ?? "";

    expect(button).toContain("disabled");
  });

  it("links back to the settings with a plain link, which a new document loads (ADR-018)", async () => {
    const html = await render(page());
    const link =
      html.match(/<a [^>]*href="\/settings\/profile"[^>]*>/)?.[0] ?? "";

    expect(link).not.toBe("");
    expect(link).not.toContain("data-discover");
  });

  describe("what an answer says", () => {
    it.each([
      [{ ok: true, intent: "add" }, "Webhook guardado"],
      [{ ok: true, intent: "remove" }, "Webhook quitado"],
      [{ ok: true, intent: "enable" }, "Webhook reactivado"],
      [
        {
          ok: true,
          intent: "test",
          delivered: true,
          status: 204,
          reason: null,
          endpointOn: true,
        },
        "Mensaje enviado. Revisa tu canal de Discord",
      ],
    ])("says %j", async (answer, text) => {
      const html = await render(page({ endpoints: [on] }, answer));

      expect(html).toContain(text);
    });

    it.each([
      ["http_404", "Discord respondió con el código 404"],
      ["http_500", "Discord respondió con el código 500"],
      ["timeout", "Discord no respondió a tiempo"],
      ["network", "no se pudo conectar con Discord"],
      ["redirect", "Discord respondió con una redirección"],
    ])("says why a test failed: %s", async (reason, text) => {
      const html = await render(
        page(
          { endpoints: [on] },
          {
            ok: true,
            intent: "test",
            delivered: false,
            status: null,
            reason,
            endpointOn: true,
          },
        ),
      );

      expect(html).toContain("No se pudo enviar el mensaje");
      expect(html).toContain(text);
      expect(html).not.toContain("El webhook se desactivó");
    });

    it("says it when the test turned the webhook off", async () => {
      const html = await render(
        page(
          { endpoints: [on] },
          {
            ok: true,
            intent: "test",
            delivered: false,
            status: 404,
            reason: "http_404",
            endpointOn: false,
          },
        ),
      );

      expect(html).toContain("El webhook se desactivó");
    });

    it.each([
      ["invalid_url", "no es la URL de un webhook de Discord"],
      ["duplicate", "Ya tienes ese webhook"],
      ["limit", "Puedes conectar hasta 3 webhooks"],
      ["not_found", "No encontramos ese webhook"],
      ["unavailable", "no están disponibles por ahora"],
      ["invalid_request", "No pudimos leer el formulario"],
    ])("says the error %s as an alert", async (error, text) => {
      const html = await render(page({}, { ok: false, error }));

      expect(html).toMatch(
        new RegExp(`<p [^>]*role="alert"[^>]*>[^<]*${text}`),
      );
    });
  });

  it("says it all in English", async () => {
    const html = await render(
      page({ endpoints: [off] }, { ok: false, error: "limit" }),
      "en",
    );

    expect(html).toContain("Notifications");
    expect(html).toContain("Connect a Discord channel");
    expect(html).toContain("That webhook no longer exists in Discord");
    expect(html).toContain("Turn back on");
    expect(html).toContain("You can connect up to 3 webhooks");
    expect(html).toContain("Back to settings");
  });

  it("leaves no text of the page untranslated, in either language, and no empty word", async () => {
    for (const locale of ["es", "en"] as const) {
      const html = await render(
        page(
          {
            endpoints: [on, off],
            deliveries: [
              {
                id: "d1",
                endpointId,
                type: "webhook.test",
                attempt: 1,
                statusCode: 204,
                latencyMs: 80,
                error: null,
                createdAt: "2026-11-02T11:00:00.000Z",
              },
            ],
          },
          {
            ok: true,
            intent: "test",
            delivered: false,
            status: 404,
            reason: "http_404",
            endpointOn: false,
          },
        ),
        locale,
      );

      // A key that has no text is drawn as the key itself.
      expect(html, locale).not.toContain("settings.notifications");
      expect(html, locale).not.toContain("undefined");
      expect(html, locale).not.toContain(">null<");
    }
  });
});
