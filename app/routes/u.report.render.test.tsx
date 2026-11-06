import { createInstance } from "i18next";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Report from "./u.$username.report";
import { resources } from "~/locales";

vi.mock("~server/auth/require", () => ({ requireUser: vi.fn() }));
vi.mock("~server/runtime-env", () => ({
  getDb: vi.fn(),
  getWriteLimiter: vi.fn(),
}));
vi.mock("~server/db/profile-lookup", () => ({ findProfile: vi.fn() }));
vi.mock("~server/db/reports", () => ({
  createReport: vi.fn(),
  cancelReport: vi.fn(),
  findMyReports: vi.fn(),
}));
vi.mock("~/middleware/i18next", () => ({ getInstance: vi.fn() }));

type Props = Parameters<typeof Report>[0];

async function render(
  loaderData: Record<string, unknown>,
  actionData?: unknown,
  locale: "es" | "en" = "es",
) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const props = {
    loaderData: {
      title: "x",
      kind: "picture",
      name: "Bob",
      username: "bob_reads",
      reasons: [
        "sexual_content",
        "sexual_minors",
        "other_person",
        "violent",
        "other",
      ],
      existing: null,
      ...loaderData,
    },
    actionData,
  } as unknown as Props;
  const element = <Report {...props} />;
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const standing = (reason: string, canCancel: boolean) => ({
  existing: { id: "report-1", reason, canCancel },
});

describe("the page of a report (SAG-142)", () => {
  it("offers each reason, says it is anonymous and warns about minors", async () => {
    const html = await render({});

    expect(html).toContain("Reportar la foto de Bob");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain("Contenido sexual con menores");
    expect(html).toContain("Esta persona no sabrá quién la reportó.");
    expect(html).toContain("no podrás cancelar el reporte");
  });

  it("does not warn about minors on a report of the person", async () => {
    const html = await render({
      kind: "user",
      reasons: ["spam", "harassment", "impersonation", "hate", "other"],
    });

    expect(html).toContain("Reportar a Bob");
    expect(html).not.toContain("no podrás cancelar");
    expect(html).toContain("Suplantación");
  });

  it("is a plain form with no picture on it", async () => {
    const html = await render({});

    expect(html).toContain('method="post"');
    expect(html).not.toContain("<img");
  });

  it("replaces the form with what was sent, and offers to cancel it", async () => {
    const html = await render(standing("violent", true));

    expect(html).toContain("Ya reportaste esta foto");
    expect(html).toContain("Tu reporte: Violenta u ofensiva.");
    expect(html).toContain("Cancelar reporte");
    expect(html).toContain('name="intent" value="cancel"');
    expect(html).not.toContain('type="radio"');
  });

  it("offers no cancel when it cannot be taken back, and says so", async () => {
    const html = await render(standing("sexual_minors", false));

    expect(html).not.toContain("Cancelar reporte");
    expect(html).toContain("Este reporte ya no se puede cancelar.");
  });

  it("shows why it was refused", async () => {
    const html = await render({}, { error: "details_required" });

    expect(html).toContain("Cuéntanos qué pasa");
    expect(html).toContain('role="alert"');
  });

  it("says it in English", async () => {
    const html = await render({}, undefined, "en");

    expect(html).toContain("Report the picture of Bob");
    expect(html).toContain("Sexual content with minors");
  });
});
