import { createInstance } from "i18next";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import ReportReview from "./reviews.$reviewId.report";
import { resources } from "~/locales";

vi.mock("~server/auth/require", () => ({ requireUser: vi.fn() }));
vi.mock("~server/runtime-env", () => ({
  getDb: vi.fn(),
  getWriteLimiter: vi.fn(),
}));
vi.mock("~server/db/reports", () => ({
  createReport: vi.fn(),
  cancelReport: vi.fn(),
}));
vi.mock("~server/db/review-reports", () => ({
  findReportableReview: vi.fn(),
  findMyReviewReport: vi.fn(),
}));
vi.mock("~/middleware/i18next", () => ({ getInstance: vi.fn() }));

type Props = Parameters<typeof ReportReview>[0];

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
      name: "Ana",
      mediaTitle: "Frieren",
      back: "/media/anime/frieren-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f#reviews",
      reasons: [
        "spoiler",
        "spam",
        "harassment",
        "hate",
        "sexual_content",
        "other",
      ],
      notice: null,
      existing: null,
      ...loaderData,
    },
    actionData,
  } as unknown as Props;
  const element = <ReportReview {...props} />;
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("the page to report a review (ADR-057)", () => {
  it("offers each reason, an unmarked spoiler first, and says which ones need the details", async () => {
    const html = await render({});

    expect(html).toContain("Reportar la reseña de Ana");
    expect(html).toContain("Volver a Frieren");
    const reasons = [...html.matchAll(/name="reason" value="(\w+)"/g)].map(
      (match) => match[1],
    );
    expect(reasons).toEqual([
      "spoiler",
      "spam",
      "harassment",
      "hate",
      "sexual_content",
      "other",
    ]);
    expect(html).toContain("Spoiler sin marcar");
    expect(html).toContain("«Spoiler sin marcar» (di qué revela)");
    expect(html).toContain('name="kind" value="review"');
    expect(html).toContain("Esta persona no sabrá quién la reportó.");
  });

  it("asks for the details when they were missing, in English too", async () => {
    const html = await render({}, { error: "details_required" }, "en");

    expect(html).toContain("Report Ana&#x27;s review");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("says it was sent, and offers to cancel an open report", async () => {
    const html = await render({
      notice: "reported",
      existing: { id: "report-1", reason: "spoiler", canCancel: true },
    });

    expect(html).toContain("Enviamos tu reporte.");
    expect(html).toContain("Ya reportaste esta reseña");
    expect(html).toContain("Tu reporte: Spoiler sin marcar.");
    expect(html).toContain('name="intent" value="cancel"');
    expect(html).not.toContain('name="reason"');
  });

  it("says a report a moderator is looking at can no longer be cancelled", async () => {
    const html = await render({
      existing: { id: "report-1", reason: "spam", canCancel: false },
    });

    expect(html).toContain("Este reporte ya no se puede cancelar.");
    expect(html).not.toContain('value="cancel"');
  });
});
