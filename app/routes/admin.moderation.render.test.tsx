import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminModeration from "./admin.moderation";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("@clerk/backend", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/auth/admin-write", () => ({}));
vi.mock("~server/db/moderation", () => ({}));
vi.mock("~server/db/account-actions", () => ({}));
vi.mock("~server/moderation/run-action", () => ({}));
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

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const photo = "https://img.clerk.com/photo-one";
const pictureReasons = [
  "sexual_content",
  "sexual_minors",
  "other_person",
  "violent",
  "other",
];
const userReasons = ["spam", "harassment", "impersonation", "hate", "other"];

const report = (fields: Record<string, unknown> = {}) => ({
  id,
  kind: "picture",
  reason: "violent",
  reasonKey: "violent",
  warnReasons: pictureReasons,
  warnSelected: "violent",
  details: null,
  createdAt: Date.parse("2026-11-06T12:00:00Z"),
  username: "bob",
  pictureUrl: photo,
  hidden: false,
  current: true,
  sensitive: false,
  account: "active",
  protected: false,
  ...fields,
});

const personReport = (fields: Record<string, unknown> = {}) =>
  report({
    kind: "user",
    reason: "spam",
    reasonKey: "spam",
    warnReasons: userReasons,
    warnSelected: "spam",
    pictureUrl: null,
    current: false,
    ...fields,
  });

const props = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Moderación",
      publishableKey: "pk_test_x",
      notice: null,
      error: null,
      confirm: null,
      detail: null,
      personQuery: null,
      person: null,
      personConfirm: null,
      personWarnReasons: userReasons,
      reports: [report()],
      accounts: [],
      uploads: [],
      ...extra,
    },
  }) as unknown as Parameters<typeof AdminModeration>[0];

const intents = (html: string) =>
  [...html.matchAll(/name="intent" value="(\w+)"/g)].map((m) => m[1]);

const dialogOf = (html: string) =>
  html.match(/<dialog[\s\S]*<\/dialog>/)?.[0] ?? "";

describe("the moderation panel (SAG-143)", () => {
  it("draws a visible picture with no referrer, and offers to dismiss it or to remove it", async () => {
    const html = await render(<AdminModeration {...props()} />);

    const image = html.match(/<img [^>]*>/)?.[0] ?? "";
    expect(image).toContain(`src="${photo}"`);
    expect(image).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("Violenta u ofensiva");
    expect(intents(html)).toEqual(["dismiss", "warn"]);
    // A link of the router, so the modal opens without loading the page again.
    const trigger = html.match(/<a [^>]*>Quitar la foto<\/a>/)?.[0] ?? "";
    expect(trigger).toContain(
      `href="/admin/moderation?confirm=${id}&amp;do=remove"`,
    );
    expect(trigger).toContain('data-discover="true"');
    expect(html).toMatch(/<a [^>]*href="\/u\/bob"/);
  });

  it("does not draw a picture reported for minors, and asks for a click to see it", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          reports: [
            report({
              reason: "sexual_minors",
              reasonKey: "sexual_minors",
              pictureUrl: null,
              hidden: true,
              sensitive: true,
            }),
          ],
        })}
      />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("Reportada por menores: no se muestra de entrada.");
    expect(html).toContain(`href="/admin/moderation?view=${id}"`);
    expect(html).toContain("La foto está oculta para todos");
  });

  it("offers to restore a hidden picture and never to dismiss it or to warn before", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          reports: [
            report({
              reason: "sexual_minors",
              reasonKey: "sexual_minors",
              hidden: true,
              sensitive: true,
            }),
          ],
        })}
      />,
    );

    expect(html).toContain("<img");
    expect(intents(html)).toEqual(["restore"]);
    expect(html).toContain("Quitar la foto");
    // Suspending and banning stay, since the person can be stopped while the picture is decided.
    expect(html).toContain("Suspender");
    expect(html).toContain("Banear");
  });

  it("offers only to dismiss a picture the person has replaced, and still the actions on the person", async () => {
    const html = await render(
      <AdminModeration {...props({ reports: [report({ current: false })] })} />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("ya cambió de foto");
    expect(intents(html)).toEqual(["dismiss", "warn"]);
    expect(html).not.toContain("do=remove");
  });

  it("opens no dialog until the address asks for it", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).not.toContain("<dialog");
  });

  it("says a reason that has no text instead of breaking", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          reports: [personReport({ reason: "copyright", reasonKey: null })],
        })}
      />,
    );

    expect(html).toContain("Motivo sin texto");
  });
});

describe("the actions on the person (SAG-143, ADR-040)", () => {
  it("offers a warning with a list of the reasons of the kind, starting on the reason of the report", async () => {
    const html = await render(
      <AdminModeration {...props({ reports: [personReport()] })} />,
    );

    expect(html).toContain("Sobre la persona");
    const form =
      html.match(
        /<form [^>]*>(?:(?!<\/form>)[\s\S])*value="warn"[\s\S]*?<\/form>/,
      )?.[0] ?? "";
    expect(form).toContain('name="reason"');
    expect(form).toContain("Motivo del aviso");
    expect(form).toContain(`name="id" value="${id}"`);
    expect(form).toMatch(/<option value="spam" selected/);
    for (const reason of userReasons) {
      expect(form).toContain(`<option value="${reason}"`);
    }
    expect(form).not.toContain('<option value="violent"');
    expect(form).toContain(">Avisar<");
  });

  it("offers the reasons of a picture for a report of a picture", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toMatch(/<option value="violent" selected/);
    expect(html).toContain('<option value="sexual_content"');
    expect(html).not.toContain('<option value="harassment"');
  });

  it("offers to suspend or ban an active account, as links that open a modal", async () => {
    const html = await render(
      <AdminModeration {...props({ reports: [personReport()] })} />,
    );

    for (const action of ["suspend", "ban"]) {
      const link =
        html.match(new RegExp(`<a [^>]*do=${action}"[^>]*>[^<]*</a>`))?.[0] ??
        "";
      expect(link).toContain(
        `href="/admin/moderation?confirm=${id}&amp;do=${action}"`,
      );
      expect(link).toContain('data-discover="true"');
    }
  });

  it("offers only to ban an account that is suspended, and says so", async () => {
    const html = await render(
      <AdminModeration
        {...props({ reports: [personReport({ account: "suspended" })] })}
      />,
    );

    expect(html).toContain("Cuenta suspendida");
    expect(html).not.toContain("do=suspend");
    expect(html).toContain("do=ban");
    // A warning is for an active account.
    expect(intents(html)).not.toContain("warn");
  });

  it("offers nothing to do to an account that is banned, and says so", async () => {
    const html = await render(
      <AdminModeration
        {...props({ reports: [personReport({ account: "banned" })] })}
      />,
    );

    expect(html).toContain("Cuenta baneada");
    expect(html).not.toContain("do=suspend");
    expect(html).not.toContain("do=ban");
    expect(intents(html)).toEqual(["dismiss"]);
  });

  it("offers nothing on the person of an administrator or of oneself", async () => {
    const html = await render(
      <AdminModeration
        {...props({ reports: [personReport({ protected: true })] })}
      />,
    );

    expect(html).toContain("no se puede actuar sobre ella");
    expect(intents(html)).toEqual(["dismiss"]);
    expect(html).not.toContain("do=ban");
    expect(html).not.toContain("<select");
  });
});

describe("the modals (SAG-143, SAG-145)", () => {
  const asking = (action: string, fields: Record<string, unknown> = {}) => ({
    confirm: { id, action },
    reports: [report(fields)],
  });

  it("asks before removing a picture, with a way back and one button that sends the removal", async () => {
    const html = await render(<AdminModeration {...props(asking("remove"))} />);

    const dialog = dialogOf(html);
    expect(dialog).toContain("Quitar la foto de bob");
    expect(dialog).toContain("también en Clerk");
    expect(intents(dialog)).toEqual(["remove"]);
    expect(dialog).toContain("Sí, quitar la foto");
    expect(dialog).toMatch(
      /<a [^>]*href="\/admin\/moderation"[^>]*>No, volver/,
    );
  });

  it.each([
    ["suspend", "Suspender a bob", "Sí, suspender", "no podrá iniciar sesión"],
    ["ban", "Banear a bob", "Sí, banear", "dejará de verse"],
  ])(
    "asks before %s, naming the person and what happens",
    async (action, title, yes, effect) => {
      const html = await render(
        <AdminModeration
          {...props(asking(action, { kind: "user", current: false }))}
        />,
      );

      const dialog = dialogOf(html);
      expect(dialog).toContain(title);
      expect(dialog.toLowerCase()).toContain(effect);
      expect(intents(dialog)).toEqual([action]);
      expect(dialog).toContain(yes);
      expect(dialog).toMatch(
        /<a [^>]*href="\/admin\/moderation"[^>]*>No, volver/,
      );
    },
  );

  it("keeps the background neutral in every modal: only the confirm button is red", async () => {
    for (const action of ["remove", "suspend", "ban"]) {
      const html = await render(<AdminModeration {...props(asking(action))} />);

      const dialog = dialogOf(html);
      expect(dialog.match(/bg-danger-bg/g)).toHaveLength(1);
      expect(dialog).not.toContain('role="alert"');
      expect(dialog).toMatch(/<button [^>]*bg-danger-bg[^>]*>Sí, /);
    }
  });

  it("does not open for an action that cannot be taken, even if the address says so", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["remove", { current: false }],
      ["suspend", { protected: true }],
      ["ban", { protected: true }],
      ["ban", { account: "banned" }],
    ];
    for (const [action, fields] of cases) {
      const html = await render(
        <AdminModeration {...props(asking(action, fields))} />,
      );

      expect(html).not.toContain("<dialog");
    }
  });

  it("opens for the report named and not for another", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          confirm: { id, action: "ban" },
          reports: [
            report({
              id: "0199a3c2-7d4e-7b1a-8c3f-000000000000",
              username: "ana",
            }),
            report(),
          ],
        })}
      />,
    );

    expect(dialogOf(html)).toContain("Banear a bob");
    expect(html.match(/<dialog/g)).toHaveLength(1);
  });
});

describe("the restricted accounts (ADR-040)", () => {
  const accounts = [
    {
      id: "u1",
      username: "carl",
      state: "banned",
      changedAt: Date.parse("2026-11-06T10:00:00Z"),
      note: "Spam repetido con <b>enlaces</b>",
    },
    {
      id: "u2",
      username: "dana",
      state: "suspended",
      changedAt: null,
      note: null,
    },
  ];

  it("lists them with their state and a button to lift each, which names the account", async () => {
    const html = await render(<AdminModeration {...props({ accounts })} />);

    expect(html).toContain("Cuentas suspendidas o baneadas");
    expect(html).toContain("Baneada");
    expect(html).toContain("Suspendida");
    expect(html).toMatch(/<a [^>]*href="\/u\/carl"/);
    expect(intents(html).filter((i) => i === "lift")).toHaveLength(2);
    expect(html).toContain('name="id" value="u1"');
    expect(html).toContain('name="id" value="u2"');
    expect(html).toContain(">Levantar<");
  });

  it("shows the internal note of the restriction only when there is one, as plain text (SAG-154)", async () => {
    const html = await render(<AdminModeration {...props({ accounts })} />);

    expect(html.match(/Nota interna:/g)).toHaveLength(1);
    expect(html).toContain("Spam repetido");
    expect(html).toContain("&lt;b&gt;enlaces&lt;/b&gt;");
    expect(html).not.toContain("<b>enlaces");
  });

  it("shows the time in Monterrey, not in UTC (SAG-154)", async () => {
    const html = await render(<AdminModeration {...props({ accounts })} />);

    // 10:00 UTC is 4:00 in Monterrey.
    expect(html).toMatch(/6 nov 2026,\s4:00/);
    expect(html).not.toContain("10:00");
  });

  it("says there are none when there are none", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toContain("No hay cuentas suspendidas ni baneadas.");
    expect(intents(html)).not.toContain("lift");
  });
});

describe("acting on a person with no report (SAG-146)", () => {
  const person = (fields: Record<string, unknown> = {}) => ({
    id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
    username: "bob_reads",
    displayName: "Bob",
    account: "active",
    protected: false,
    ...fields,
  });
  const found = (
    fields: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) =>
    props({
      personQuery: "bob_reads",
      person: person(fields),
      reports: [],
      ...extra,
    });

  it("has a search by username that sends a GET, and no card until somebody is searched", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toContain("Actuar sobre una persona");
    const form =
      html.match(/<form [^>]*method="get"[^>]*>[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain('name="person"');
    expect(form).toContain(">Buscar<");
    expect(html).not.toContain("No encontramos a nadie");
    expect(html).not.toContain('name="username"');
  });

  it("says when nobody has the username that was searched, and keeps it in the box", async () => {
    const html = await render(
      <AdminModeration {...props({ personQuery: "ghost_user" })} />,
    );

    expect(html).toContain(
      "No encontramos a nadie con el usuario «ghost_user».",
    );
    expect(html).toMatch(
      /name="person"[^>]*value="ghost_user"|value="ghost_user"[^>]*name="person"/,
    );
  });

  it("draws the card of the person with a link to the profile, and the actions by username", async () => {
    const html = await render(<AdminModeration {...found()} />);

    expect(html).toMatch(/<a [^>]*href="\/u\/bob_reads"/);
    expect(html).toContain("Bob");
    expect(intents(html)).toEqual(["warn_person"]);
    expect(html).toContain('name="username" value="bob_reads"');
    // No id of a person is sent by the warning, and no report either.
    const warning =
      html.match(
        /<form [^>]*>(?:(?!<\/form>)[\s\S])*value="warn_person"[\s\S]*?<\/form>/,
      )?.[0] ?? "";
    expect(warning).not.toContain('name="id"');
    expect(warning).toContain('name="note"');
    expect(warning).toContain("Nota interna");
    expect(warning).toMatch(/<option value="harassment" selected/);
    expect(html).toContain(
      'href="/admin/moderation?person=bob_reads&amp;do=suspend"',
    );
    expect(html).toContain(
      'href="/admin/moderation?person=bob_reads&amp;do=ban"',
    );
  });

  it("offers to lift the restriction of a suspended or banned person, with the card to come back to", async () => {
    for (const account of ["suspended", "banned"]) {
      const html = await render(<AdminModeration {...found({ account })} />);

      const lift =
        html.match(
          /<form [^>]*>(?:(?!<\/form>)[\s\S])*value="lift"[\s\S]*?<\/form>/,
        )?.[0] ?? "";
      expect(lift).toContain(
        'name="id" value="0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70"',
      );
      expect(lift).toContain('name="username" value="bob_reads"');
      expect(lift).toContain(">Levantar<");
    }
    const active = await render(<AdminModeration {...found()} />);
    expect(intents(active)).not.toContain("lift");
  });

  it("offers nothing on an administrator or on oneself", async () => {
    const html = await render(
      <AdminModeration {...found({ protected: true, account: "suspended" })} />,
    );

    expect(html).toContain("no se puede actuar sobre ella");
    expect(intents(html)).toEqual([]);
    expect(html).not.toContain("do=ban");
  });

  it.each([
    ["suspend", "Suspender a bob_reads", "Sí, suspender", "suspend_person"],
    ["ban", "Banear a bob_reads", "Sí, banear", "ban_person"],
  ])(
    "asks before %s in a modal with a note, that goes back to the card",
    async (action, title, yes, intent) => {
      const html = await render(
        <AdminModeration {...found({}, { personConfirm: action })} />,
      );

      const dialog = dialogOf(html);
      expect(dialog).toContain(title);
      expect(dialog).toContain(yes);
      expect(intents(dialog)).toEqual([intent]);
      expect(dialog).toContain('name="username" value="bob_reads"');
      expect(dialog).toContain('name="note"');
      expect(dialog).toMatch(/maxLength="200"/);
      // The note sits above the buttons and still travels with the form of the confirm button.
      const noteInput =
        dialog.match(/<input [^>]*name="note"[^>]*>/)?.[0] ?? "";
      const formId = noteInput.match(/ form="([^"]+)"/)?.[1] ?? "";
      expect(formId).not.toBe("");
      expect(dialog).toContain(`id="${formId}"`);
      expect(dialog.indexOf('name="note"')).toBeLessThan(
        dialog.indexOf("No, volver"),
      );
      expect(dialog).toMatch(
        /<a [^>]*href="\/admin\/moderation\?person=bob_reads"[^>]*>No, volver/,
      );
      // Neutral background, and only the confirm button is red.
      expect(dialog.match(/bg-danger-bg/g)).toHaveLength(1);
    },
  );

  it("does not open for an action that cannot be taken, even if the address says so", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["suspend", { account: "suspended" }],
      ["suspend", { account: "banned" }],
      ["ban", { account: "banned" }],
      ["ban", { protected: true }],
    ];
    for (const [action, fields] of cases) {
      const html = await render(
        <AdminModeration {...found(fields, { personConfirm: action })} />,
      );

      expect(html).not.toContain("<dialog");
    }
  });

  it("is written in English", async () => {
    const html = await render(<AdminModeration {...found()} />, "en");

    expect(html).toContain("Act on a person");
    expect(html).toContain(">Search<");
    expect(html).toContain("Internal note");
  });
});

describe("the rest of the page", () => {
  it("sends the id and the action as hidden fields of a POST, and nothing else", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toMatch(/<form [^>]*method="post"/);
    expect(html).toContain(`name="id" value="${id}"`);
  });

  it("shows the time of a report in Monterrey (SAG-154)", async () => {
    const html = await render(<AdminModeration {...props()} />);

    // 12:00 UTC is 6:00 in Monterrey.
    expect(html).toMatch(/6 nov 2026,\s6:00/);
    expect(html).not.toContain("12:00");
  });

  it("lists the uploads with their answer, their score and the date", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          uploads: [
            {
              id: "u1",
              username: "carl",
              result: "rejected",
              score: 0.93,
              createdAt: Date.parse("2026-11-06T10:00:00Z"),
            },
            {
              id: "u2",
              username: "dana",
              result: "allowed",
              score: 0.4,
              createdAt: Date.parse("2026-11-06T09:00:00Z"),
            },
          ],
        })}
      />,
    );

    expect(html).toContain("carl");
    expect(html).toContain("Rechazada");
    expect(html).toContain("Puntaje 0,93");
    expect(html).toContain("Aceptada, cerca del límite");
  });

  it("says what happened, and why an action did not, for each new word", async () => {
    const notices: [string, string][] = [
      ["warned", "Aviso enviado"],
      ["suspended", "Cuenta suspendida"],
      ["banned", "Cuenta baneada"],
      ["lifted", "Se levantó la restricción de la cuenta"],
      ["banned_no_clerk", "Clerk no aplicó el baneo"],
      ["lifted_no_clerk", "Clerk no cambió nada"],
    ];
    for (const [notice, text] of notices) {
      const html = await render(<AdminModeration {...props({ notice })} />);
      // A toast, or plain text for the ones that carry a warning about Clerk (SAG-159).
      expect(html).toMatch(
        new RegExp(`role="status"[^>]*>[\\s\\S]*?font-semibold">[^<]*${text}`),
      );
    }
    const errors: [string, string][] = [
      ["failed", "Clerk no hizo el cambio"],
      ["not_allowed", "no se puede actuar sobre ella"],
      ["picture_hidden", "primero restáurala o quítala"],
    ];
    for (const [error, text] of errors) {
      const html = await render(<AdminModeration {...props({ error })} />);
      expect(html).toMatch(new RegExp(`role="alert"[^>]*>[^<]*${text}`));
    }
  });

  it("says what Clerk answered when it refused, and the plain line when it said nothing", async () => {
    const withDetail = await render(
      <AdminModeration
        {...props({ error: "failed", detail: "403 feature_not_enabled" })}
      />,
    );
    const without = await render(
      <AdminModeration {...props({ error: "failed" })} />,
    );
    const en = await render(
      <AdminModeration
        {...props({ error: "failed", detail: "403 feature_not_enabled" })}
      />,
      "en",
    );

    expect(withDetail).toMatch(
      /role="alert"[^>]*>[^<]*Clerk no hizo el cambio \(403 feature_not_enabled\)/,
    );
    expect(without).toMatch(
      /role="alert"[^>]*>[^<]*Clerk no hizo el cambio\. No/,
    );
    expect(without).not.toContain("(");
    expect(en).toContain(
      "Clerk did not make the change (403 feature_not_enabled)",
    );
  });

  it("says there is nothing to review when there is nothing", async () => {
    const html = await render(<AdminModeration {...props({ reports: [] })} />);

    expect(html).toContain("No hay reportes abiertos.");
    expect(html).toContain("No hay intentos que revisar.");
  });

  it("shows the sections of the administration as tabs, with plain anchors", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toMatch(/<a [^>]*href="\/admin\/sagas"/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/moderation"[^>]*aria-current="page"/,
    );
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/moderation"[^>]*class="[^"]*bg-accent/,
    );
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/sagas"[^>]*class="[^"]*border-border/,
    );
  });

  it("is written in English for an English page", async () => {
    const html = await render(
      <AdminModeration {...props({ reports: [personReport()] })} />,
      "en",
    );

    expect(html).toContain("Open reports");
    expect(html).toContain("About the person");
    expect(html).toContain(">Warn<");
    expect(html).toContain(">Suspend<");
    expect(html).toContain(">Ban<");
    expect(html).toContain("Suspended or banned accounts");
  });
});
