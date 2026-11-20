import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { FeedEntry } from "~/components/FeedEntry";
import { ReviewForm } from "~/components/reviews/ReviewForm";
import { TitleReviews } from "~/components/reviews/TitleReviews";
import { resources } from "~/locales";
import type { ReviewPageData } from "./library.$mediaId.review";
import type { ReviewItem, TitleReviewsData } from "./media.$type.$slug";
import type { FeedItem } from "./social";

// SAG-22, ADR-053: the reviews as the title page, the feed and the form draw them.

vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));

async function render(element: ReactNode, locale: "es" | "en" = "es") {
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

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const path = `/media/anime/frieren-${mediaId}`;

const item = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "review-1",
  activityId: "0199a3c2-0000-7000-8000-000000000001",
  excerpt: "El principio de la reseña",
  rest: " y el resto del texto.",
  spoiler: false,
  level: "public",
  createdAt: "2026-11-20T12:00:00.000Z",
  edited: false,
  mine: false,
  removed: false,
  author: { username: "ana_reads", displayName: "Ana", avatarUrl: null },
  score: 9,
  likes: 3,
  liked: false,
  ...overrides,
});

const block = (
  overrides: Partial<TitleReviewsData> = {},
): TitleReviewsData => ({
  order: "relevant",
  page: 1,
  more: false,
  items: [item()],
  write: "write",
  ...overrides,
});

const titleReviews = (reviews: TitleReviewsData) => (
  <TitleReviews reviews={reviews} mediaId={mediaId} path={path} />
);

describe("the reviews of a title page", () => {
  it("draws a review with its author, score, excerpt, the rest behind see more, and a like", async () => {
    const html = await render(titleReviews(block()));

    expect(html).toContain('id="reviews"');
    expect(html).toMatch(/<h2[^>]*id="reviews-title"[^>]*>Reseñas<\/h2>/);
    expect(html).toContain('href="/u/ana_reads"');
    expect(html).toContain("Puntuación: 9/10");
    expect(html).toContain("El principio de la reseña");
    expect(html).toMatch(/<summary[^>]*>Ver más<\/summary>/);
    expect(html).toContain(`action="${path}"`);
    expect(html).toContain("3 me gusta");
  });

  it("hides a spoiler behind a warning and a button that works without JavaScript", async () => {
    const html = await render(
      titleReviews(block({ items: [item({ spoiler: true })] })),
    );

    expect(html).toContain("Esta reseña contiene spoilers.");
    const reveal = html.indexOf("Mostrarla de todos modos");
    expect(reveal).toBeGreaterThan(0);
    expect(html.indexOf("<details", html.indexOf("spoilers."))).toBeLessThan(
      reveal,
    );
    expect(html.indexOf("El principio de la reseña")).toBeGreaterThan(reveal);
  });

  it("marks the viewer's own review, its level and no like button", async () => {
    const html = await render(
      titleReviews(
        block({
          items: [item({ mine: true, level: "friends", edited: true })],
        }),
      ),
    );

    expect(html).toContain("Tu reseña");
    expect(html).toContain("(editada)");
    expect(html).not.toContain('href="/u/ana_reads"');
    expect(html).not.toContain('name="activityId"');
  });

  it("offers to write or edit with a plain link to the form, or says to start the title first", async () => {
    const write = await render(titleReviews(block({ write: "write" })));
    expect(write).toMatch(
      new RegExp(
        `<a href="/library/${mediaId}/review"[^>]*>Escribir una reseña</a>`,
      ),
    );
    // A plain link: a router link would carry data-discover.
    expect(write).not.toMatch(/review"[^>]*data-discover/);

    const edit = await render(titleReviews(block({ write: "edit" })));
    expect(edit).toContain("Editar tu reseña");

    const start = await render(titleReviews(block({ write: "start_first" })));
    expect(start).toContain("primero marca este título como en progreso");
    expect(start).not.toContain(`/library/${mediaId}/review`);

    const visitor = await render(titleReviews(block({ write: "sign_in" })));
    expect(visitor).not.toContain(`/library/${mediaId}/review`);
  });

  it("shows the order chosen as the current one, and the pages", async () => {
    const html = await render(
      titleReviews(block({ order: "recent", page: 2, more: true })),
    );

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Más recientes<\/a>/);
    expect(html).toContain('href="/?reviews=recent&amp;reviewsPage=3#reviews"');
    expect(html).toContain('href="/?reviews=recent#reviews"');
    expect(html).toContain("Ver más reseñas");
    expect(html).toContain("Reseñas anteriores");
  });

  it("says so when there is nothing to see, in English too", async () => {
    expect(await render(titleReviews(block({ items: [] })))).toContain(
      "Todavía no hay reseñas que puedas ver.",
    );
    expect(await render(titleReviews(block({ items: [] })), "en")).toContain(
      "There are no reviews you can see yet.",
    );
  });
});

const feedItem = (review: FeedItem["review"]): FeedItem => ({
  id: "0199a3c2-0000-7000-8000-000000000002",
  kind: "reviewed",
  progress: null,
  score: null,
  createdAt: "2026-11-20T12:00:00.000Z",
  level: "public",
  mine: false,
  actor: { username: "ana_reads", displayName: "Ana", avatarUrl: null },
  media: { href: path, title: "Frieren", poster: null },
  likes: 0,
  liked: false,
  review,
});

describe("a review in the feed", () => {
  it("says what happened and shows the start with a link to the whole review", async () => {
    const html = await render(
      <ul>
        <FeedEntry
          item={feedItem({
            id: "review-1",
            excerpt: "Muy buena",
            more: true,
            spoiler: false,
            removed: false,
          })}
        />
      </ul>,
    );

    expect(html).toContain("reseñó");
    expect(html).toMatch(/Muy buena(<!-- -->)?…/);
    expect(html).toContain(`href="${path}#reviews"`);
    expect(html).toContain("Leer la reseña completa");
  });

  it("hides the start of a review with spoilers", async () => {
    const html = await render(
      <ul>
        <FeedEntry
          item={feedItem({
            id: "review-1",
            excerpt: "El final",
            more: false,
            spoiler: true,
            removed: false,
          })}
        />
      </ul>,
    );

    expect(html.indexOf("Mostrarla de todos modos")).toBeLessThan(
      html.indexOf("El final"),
    );
    expect(html).not.toContain("Leer la reseña completa");
  });
});

const formData = (overrides: Partial<ReviewPageData> = {}) =>
  ({
    title: "Reseña de Frieren | SagaShelf",
    publishableKey: "pk",
    media: { id: mediaId, title: "Frieren", path },
    canWrite: true,
    entry: { score: 8, visibility: "public" },
    review: null,
    defaultVisibility: "public",
    privateProfile: false,
    held: false,
    ...overrides,
  }) as ReviewPageData;

describe("the form of a review", () => {
  it("has a labelled text with its limits, the spoiler box, the level and the score", async () => {
    const html = await render(
      <ReviewForm data={formData()} error={null} sent={null} />,
    );

    expect(html).toContain('for="review-body"');
    expect(html).toContain("Entre 500 y 5000 caracteres");
    expect(html).toContain("0 de 5000 caracteres");
    expect(html).toContain('name="spoiler"');
    expect(html).toMatch(
      /<option value="public" selected="">Todas las personas/,
    );
    expect(html).toMatch(/<option value="8" selected="">8<\/option>/);
    expect(html).toContain("Publicar reseña");
    expect(html).not.toContain("Borrar mi reseña");
  });

  it("warns when the entry is more private than the review", async () => {
    const html = await render(
      <ReviewForm
        data={formData({ entry: { score: null, visibility: "private" } })}
        error={null}
        sent={null}
      />,
    );
    expect(html).toContain("En tu biblioteca este título es más privado");
  });

  it("tells a new account and a Total privacy profile who will see it", async () => {
    expect(
      await render(
        <ReviewForm data={formData({ held: true })} error={null} sent={null} />,
      ),
    ).toContain("Tu cuenta es nueva");
    expect(
      await render(
        <ReviewForm
          data={formData({ privateProfile: true })}
          error={null}
          sent={null}
        />,
      ),
    ).toContain("Privacidad total");
  });

  it("keeps what was sent and says why it was refused", async () => {
    const html = await render(
      <ReviewForm
        data={formData()}
        error="link"
        sent={{
          body: "mi texto",
          spoiler: true,
          visibility: "friends",
          score: null,
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("una reseña no puede tenerlos");
    expect(html).toContain("mi texto</textarea>");
    expect(html).toMatch(/name="spoiler" checked=""/);
    expect(html).toMatch(/<option value="friends" selected="">/);
  });

  it("offers to delete an existing review", async () => {
    const html = await render(
      <ReviewForm
        data={formData({
          review: {
            body: "texto",
            spoiler: false,
            visibility: "public",
            removed: false,
            spoilerAsked: false,
          },
        })}
        error={null}
        sent={null}
      />,
    );
    expect(html).toContain("Guardar cambios");
    expect(html).toContain("Borrar mi reseña");
    expect(html).toContain('value="delete"');
  });
});

describe("reporting a review and a review removed by a moderator (ADR-057)", () => {
  const reportHref = 'href="/reviews/review-1/report"';

  it("offers to report somebody else's review with a plain link, never one's own", async () => {
    const html = await render(titleReviews(block()));
    const link = html.match(/<a [^>]*>Reportar<\/a>/)?.[0] ?? "";
    expect(link).toContain(reportHref);
    // A plain link to a session page (ADR-018), not one of the router.
    expect(link).not.toContain("data-discover");

    const own = await render(
      titleReviews(block({ items: [item({ mine: true })] })),
    );
    expect(own).not.toContain(reportHref);
  });

  it("tells the author on the title page that a moderator removed it", async () => {
    const html = await render(
      titleReviews(block({ items: [item({ mine: true, removed: true })] })),
    );
    expect(html).toContain("Un moderador quitó esta reseña: solo tú la ves.");
    expect(await render(titleReviews(block()))).not.toContain(
      "Un moderador quitó",
    );
  });

  it("offers to report a review in the feed, and tells its author when it was removed", async () => {
    const review = {
      id: "review-1",
      excerpt: "Muy buena",
      more: false,
      spoiler: false,
      removed: false,
    };
    const other = await render(
      <ul>
        <FeedEntry item={feedItem(review)} />
      </ul>,
    );
    expect(other).toContain(reportHref);

    const own = await render(
      <ul>
        <FeedEntry
          item={{ ...feedItem({ ...review, removed: true }), mine: true }}
        />
      </ul>,
      "en",
    );
    expect(own).not.toContain(reportHref);
    expect(own).toContain(
      "A moderator removed this review: only you can see it.",
    );
  });

  it("shows a removed review to its author with no form, only the delete", async () => {
    const html = await render(
      <ReviewForm
        data={formData({
          review: {
            body: "mi texto quitado",
            spoiler: false,
            visibility: "public",
            removed: true,
            spoilerAsked: false,
          },
        })}
        error={null}
        sent={null}
      />,
    );

    expect(html).toContain("Un moderador quitó esta reseña porque");
    expect(html).toContain("mi texto quitado");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('value="save"');
    expect(html).toContain('value="delete"');
  });

  it("tells the author a moderator asks for the spoiler mark, above the form", async () => {
    const html = await render(
      <ReviewForm
        data={formData({
          review: {
            body: "texto",
            spoiler: false,
            visibility: "public",
            removed: false,
            spoilerAsked: true,
          },
        })}
        error={null}
        sent={null}
      />,
    );

    const notice = html.indexOf("Un moderador te pide marcar");
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(html.indexOf('name="spoiler"'));
    expect(html).toContain("<textarea");
  });
});
