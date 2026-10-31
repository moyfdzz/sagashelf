import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import LibraryEntry from "./library.$mediaId";
import MediaDetail from "./media.$type.$slug";
import { resources } from "~/locales";

// The loaders and actions are tested in their own files; here only the pages are drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));

// Clerk's script is not what these tests are about.
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => children,
}));

async function render(
  locale: "es" | "en",
  element: ReactNode,
  path = "/",
): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter([{ path, element }], {
    initialEntries: [path],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

// The library page has its own file: library.sections.render.test.tsx.

const entryProps = (
  entry: Record<string, unknown> = {},
  actionData?: unknown,
  extra: Record<string, unknown> = {},
) =>
  ({
    loaderData: {
      title: "Mi biblioteca",
      publishableKey: "publishable-key-for-tests",
      backToLibrary: null,
      entry: {
        mediaId,
        status: "in_progress",
        progress: 2,
        progressUnit: null,
        progressTotal: null,
        score: 8,
        startedAt: "2026-01-02",
        finishedAt: null,
        notes: "una nota",
        visibility: "private",
        ...entry,
      },
      media: {
        title: "Ataque a los Titanes",
        type: "anime",
        year: 2013,
        poster: "/img/tmdb/w185/aot.jpg",
        detailPath: `/media/anime/ataque-a-los-titanes-${mediaId}`,
      },
      viewings: [],
      timesWatched: 0,
      totalEpisodes: 4,
      progressUnits: [],
      progressAt: { season: 1, episode: 2 },
      ...extra,
    },
    actionData,
  }) as unknown as Parameters<typeof LibraryEntry>[0];

describe("the entry page", () => {
  it("shows the fields with what is saved and where the progress leaves the person", async () => {
    const html = await render("es", <LibraryEntry {...entryProps()} />);

    expect(html).toContain("Ataque a los Titanes");
    expect(html).toContain('name="intent" value="save"');
    expect(html).toContain(
      '<option value="in_progress" selected="">En curso</option>',
    );
    expect(html).toContain('value="2"');
    expect(html).toContain("De 4 episodios.");
    expect(html).toContain("Vas en la temporada 1, episodio 2.");
    expect(html).toContain('<option value="8" selected="">8 de 10</option>');
    expect(html).toContain('value="2026-01-02"');
    expect(html).toContain(">una nota</textarea>");
    expect(html).toContain("Lo has visto 0 veces.");
    // Not completed: no button to watch it again.
    expect(html).not.toContain("Volver a verlo");
  });

  it("has no maxlength on the notes, and no count until a script can update it", async () => {
    const html = await render("es", <LibraryEntry {...entryProps()} />);

    const notes = /<textarea[^>]*id="notes"[^>]*>/.exec(html)?.[0] ?? "";
    expect(notes).toBeTruthy();
    expect(notes).not.toContain("maxLength");
    expect(notes).not.toContain("maxlength");
    // The hint stays; the count is drawn after the page has loaded.
    expect(html).toContain("Hasta 2000 caracteres.");
    expect(html).not.toContain('id="notes-count"');
  });

  it("lets the finish date be set only while the title is completed", async () => {
    const open = await render("es", <LibraryEntry {...entryProps()} />);
    const done = await render(
      "es",
      <LibraryEntry {...entryProps({ status: "completed" })} />,
    );

    const finishField = (html: string) =>
      /<input id="finishedAt"[^>]*>/.exec(html)?.[0] ?? "";
    expect(finishField(open)).toContain('disabled=""');
    expect(finishField(done)).not.toContain('disabled=""');
    expect(open).toContain(
      "Solo se puede poner cuando el estado es Completado.",
    );
  });

  it("offers to watch a completed title again, and to remove the entry", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps({ status: "completed" }, undefined, {
          viewings: [
            {
              id: "0199a3c2-7d4e-7b1a-8c3f-bbbbbbbbbbbb",
              startedOn: "2025-05-01",
              finishedOn: "2025-05-03",
              notes: "En el cine",
            },
          ],
          timesWatched: 2,
        })}
      />,
    );

    expect(html).toContain('name="intent" value="rewatch"');
    expect(html).toContain("Volver a verlo");
    expect(html).toContain("Lo has visto 2 veces.");
    expect(html).toContain("Del 1 de mayo de 2025 al 3 de mayo de 2025");
    expect(html).toContain("En el cine");
    expect(html).toContain('name="intent" value="viewing_add"');
    expect(html).toContain('value="viewing_save"');
    expect(html).toContain('value="viewing_remove"');
    expect(html).toContain('name="intent" value="remove"');
    expect(html).toContain("Quitar de mi biblioteca");
  });

  it("does not ask for episodes of a title that has none", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps({ progress: 0 }, undefined, {
          totalEpisodes: 0,
          progressAt: null,
        })}
      />,
    );

    expect(html).not.toContain('id="progress"');
    expect(html).toContain('type="hidden" name="progress" value="0"');
  });

  it("gives the links of the entry the shared look, with an arrow on the one that goes to the title", async () => {
    const html = await render("es", <LibraryEntry {...entryProps()} />);

    const back = /<a [^>]*>Volver a mi biblioteca<\/a>/.exec(html)?.[0] ?? "";
    const title =
      /<a [^>]*>Ver la página del título<\/a>/.exec(html)?.[0] ?? "";
    expect(back).toContain("hover:text-link-hover");
    expect(back).not.toContain("→");
    expect(title).toContain("hover:text-link-hover");
    expect(title).toContain("→");
  });

  describe("the link back to the library", () => {
    const backLink = (html: string) =>
      /<a [^>]*href="([^"]*)"[^>]*>Volver a mi biblioteca<\/a>/.exec(html)?.[1];

    it("goes back to the library as the person left it", async () => {
      const html = await render(
        "es",
        <LibraryEntry
          {...entryProps({}, undefined, {
            backToLibrary: "/library?type=book&completed_page=2",
          })}
        />,
      );

      expect(backLink(html)).toBe("/library?type=book&amp;completed_page=2");
    });

    it("goes to the plain library when the person did not come from it", async () => {
      const html = await render("es", <LibraryEntry {...entryProps()} />);

      expect(backLink(html)).toBe("/library");
    });
  });

  describe("the words about watching again", () => {
    const completed = (type: string, locale: "es" | "en") =>
      render(
        locale,
        <LibraryEntry
          {...entryProps({ status: "completed" }, undefined, {
            totalEpisodes: 0,
            progressAt: null,
            timesWatched: 2,
            media: { ...entryProps().loaderData.media, type },
          })}
        />,
      );

    it.each(["book", "manga"])("say read for a %s", async (type) => {
      const es = await completed(type, "es");
      const en = await completed(type, "en");

      expect(es).toContain("Volver a leerlo");
      expect(es).toContain("Veces que lo has leído");
      expect(es).toContain("Lo has leído 2 veces.");
      expect(es).toContain("empieza de nuevo desde el principio");
      expect(es).not.toMatch(/Volver a verlo|has visto|episodio/);
      expect(en).toContain("Read it again");
      expect(en).toContain("Times you have read it");
      expect(en).toContain("You have read it 2 times.");
      expect(en).not.toMatch(/Watch it again|watched it|episode/);
    });

    it.each(["series", "anime", "movie"])(
      "keep saying watched for %s",
      async (type) => {
        const html = await completed(type, "es");

        expect(html).toContain("Volver a verlo");
        expect(html).toContain("Lo has visto 2 veces.");
        expect(html).not.toContain("leído");
      },
    );

    it("says read in the message after starting a book again, and in its error", async () => {
      const media = { ...entryProps().loaderData.media, type: "book" };
      const saved = await render(
        "es",
        <LibraryEntry
          {...entryProps(
            {},
            { ok: true, saved: "rewatch", savedAt: 1 },
            { media },
          )}
        />,
      );
      const refused = await render(
        "es",
        <LibraryEntry
          {...entryProps(
            {},
            { ok: false, errors: { form: "not_completed" } },
            { media },
          )}
        />,
      );

      expect(saved).toContain("Empezaste de nuevo desde el principio.");
      expect(refused).toContain(
        "Solo puedes volver a leer un título completado.",
      );
    });
  });

  it("asks for the pages of a book, and for an optional total", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps(
          { progress: 120, progressUnit: "pages", progressTotal: 320 },
          undefined,
          {
            totalEpisodes: 0,
            progressAt: null,
            progressUnits: ["pages"],
            media: { ...entryProps().loaderData.media, type: "book" },
          },
        )}
      />,
    );

    expect(html).toContain("Páginas leídas");
    expect(html).toContain("Total de páginas");
    expect(html).toContain('id="progress"');
    expect(html).toContain('value="120"');
    expect(html).toContain('name="progressTotal"');
    expect(html).toContain('value="320"');
    // A book has only pages: nothing to pick.
    expect(html).toContain('type="hidden" name="progressUnit" value="pages"');
    expect(html).not.toContain('id="progressUnit"');
    expect(html).not.toContain("Episodios vistos");
  });

  it("lets a manga count chapters or volumes", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps(
          { progress: 3, progressUnit: "volumes", progressTotal: 12 },
          undefined,
          {
            totalEpisodes: 0,
            progressAt: null,
            progressUnits: ["chapters", "volumes"],
            media: { ...entryProps().loaderData.media, type: "manga" },
          },
        )}
      />,
    );

    expect(html).toContain('id="progressUnit"');
    expect(html).toContain(
      '<option value="volumes" selected="">Tomos</option>',
    );
    expect(html).toContain('<option value="chapters">Capítulos</option>');
    expect(html).toContain("Tomos leídos");
    expect(html).toContain("Total de tomos");
  });

  it("starts a manga in chapters when it has no unit yet", async () => {
    const html = await render(
      "en",
      <LibraryEntry
        {...entryProps({}, undefined, {
          totalEpisodes: 0,
          progressAt: null,
          progressUnits: ["chapters", "volumes"],
        })}
      />,
    );

    expect(html).toContain("Chapters read");
  });

  it("marks the field of an error, with its message", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps(
          {},
          { ok: false, errors: { progress: "progress_too_high" } },
        )}
      />,
    );

    expect(html).toContain("Revisa los campos marcados.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="progress-error"');
    expect(html).toContain("El progreso supera el total del título.");
  });

  it("announces that it saved", async () => {
    const html = await render(
      "en",
      <LibraryEntry
        {...entryProps({}, { ok: true, saved: "save", savedAt: 1 })}
      />,
    );

    expect(html).toContain("Your entry was saved.");
  });
});

const detailProps = (library: Record<string, unknown>) =>
  ({
    loaderData: {
      id: mediaId,
      library,
      type: "anime",
      title: "Ataque a los Titanes",
      pageTitle: "Ataque a los Titanes | SagaShelf",
      originalTitle: null,
      creators: [],
      genres: [],
      year: 2013,
      status: "finished",
      synopsis: "Sinopsis",
      synopsisLocale: "es",
      description: "Sinopsis",
      poster: null,
      seasons: [],
      related: [],
      sagas: [],
      nextEpisode: null,
      source: null,
      canonicalUrl: "https://sagashelf.app/x",
      shareImageUrl: null,
      jsonLd: {},
    },
  }) as unknown as Parameters<typeof MediaDetail>[0];

const inLibrary = (overrides: Record<string, unknown> = {}) => ({
  signedIn: true,
  status: "in_progress",
  progress: 3,
  progressUnit: null,
  progressTotal: null,
  totalEpisodes: 12,
  ...overrides,
});

/** The page while a form of the library panel is on its way to the server and has no answer. */
async function renderSending(
  action: string,
  fields: Record<string, string>,
  element: ReactNode,
): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter(
    [
      { path: "/", element },
      {
        id: "sent",
        path: "/library/:mediaId/:what",
        action: () => new Promise(() => undefined),
      },
      {
        id: "added",
        path: "/library/add",
        action: () => new Promise(() => undefined),
      },
    ],
    { initialEntries: ["/"] },
  );
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  void router.fetch(
    `library-${mediaId}`,
    action === "/library/add" ? "added" : "sent",
    action,
    { formMethod: "post", formData },
  );
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("the library block of the title page", () => {
  const page = (library: Record<string, unknown>, locale: "es" | "en" = "es") =>
    render(locale, <MediaDetail {...detailProps(library)} />);
  const buttons = (html: string) =>
    html.match(/<button[^>]*name="status"[^>]*>[^<]*<\/button>/g) ?? [];

  it("lets a signed-in person add the title with a form that works without JavaScript", async () => {
    const html = await page({ signedIn: true, status: null });

    expect(html).toContain('action="/library/add"');
    expect(html).toContain('method="post"');
    expect(html).toContain(`name="mediaId" value="${mediaId}"`);
    expect(html).toContain("Añadir a mi biblioteca");
    expect(buttons(html)).toHaveLength(0);
  });

  it("shows the five statuses as buttons, the current one pressed, each a plain form button", async () => {
    const html = await page(inLibrary({ status: "paused" }));

    expect(html).toContain("En tu biblioteca");
    expect(html).toContain(`action="/library/${mediaId}/status"`);
    const found = buttons(html);
    expect(
      found.map((button) => /value="([a-z_]+)"/.exec(button)?.[1]),
    ).toEqual(["planned", "in_progress", "completed", "paused", "dropped"]);
    expect(
      found.filter((button) => button.includes('aria-pressed="true"')),
    ).toHaveLength(1);
    expect(found.find((button) => button.includes("En pausa"))).toContain(
      'aria-pressed="true"',
    );
    expect(html).not.toContain("Añadir a mi biblioteca");
    expect(html).toContain(`href="/library/${mediaId}"`);
    expect(html).toContain("Editar mi entrada");
  });

  it("says what the group is for, so a screen reader announces it", async () => {
    const html = await page(inLibrary());

    expect(html).toMatch(/role="group"[^>]*aria-label="Cambiar el estado"/);
  });

  it("says the status in English", async () => {
    const html = await page(inLibrary({ status: "completed" }), "en");

    expect(html).toContain("In your library");
    expect(html).toContain("Change the status");
    expect(html).toContain("Completed");
  });

  it("turns off planned once there is progress, unless it is the status the title has", async () => {
    const withProgress = buttons(await page(inLibrary({ progress: 3 })));
    const without = buttons(
      await page(inLibrary({ status: "paused", progress: 0 })),
    );
    const planned = buttons(
      await page(inLibrary({ status: "planned", progress: 0 })),
    );

    const plannedOf = (found: string[]) =>
      found.find((button) => button.includes('value="planned"')) ?? "";
    expect(plannedOf(withProgress)).toContain('disabled=""');
    expect(plannedOf(without)).not.toContain('disabled=""');
    expect(plannedOf(planned)).not.toContain('disabled=""');
  });

  it("shows the progress with a bar and a +1 that goes to the step of the entry", async () => {
    const html = await page(inLibrary());

    expect(html).toContain("3 de 12 episodios");
    expect(html).toContain('max="12"');
    expect(html).toContain(`action="/library/${mediaId}/step"`);
    expect(html).toContain('aria-label="+1 episodio: Ataque a los Titanes"');
    expect(html).toContain(">+1<");
  });

  it("counts the pages of a book against its total, and chapters with no total", async () => {
    const book = await page(
      inLibrary({
        progress: 120,
        progressUnit: "pages",
        progressTotal: 320,
        totalEpisodes: 0,
      }),
    );
    const manga = await page(
      inLibrary({
        progress: 40,
        progressUnit: "chapters",
        progressTotal: null,
        totalEpisodes: 0,
      }),
    );

    expect(book).toContain("120 de 320 páginas");
    expect(book).toContain('aria-label="+1 página: Ataque a los Titanes"');
    expect(manga).toContain("40 capítulos");
    expect(manga).not.toContain("<progress");
    expect(manga).toContain('aria-label="+1 capítulo: Ataque a los Titanes"');
  });

  it("has no +1 for a completed title, one at its end, or one with nothing to count", async () => {
    for (const library of [
      inLibrary({ status: "completed", progress: 12 }),
      inLibrary({ progress: 12 }),
      inLibrary({ progress: 0, totalEpisodes: 0 }),
    ]) {
      expect(await page(library)).not.toContain(`/library/${mediaId}/step`);
    }
  });

  it("sends a visitor to sign in", async () => {
    const html = await render(
      "en",
      <MediaDetail
        {...detailProps({
          signedIn: false,
          status: null,
          signInPath: "/sign-in?redirectTo=%2Fmedia%2Fx",
        })}
      />,
    );

    expect(html).toContain('href="/sign-in?redirectTo=%2Fmedia%2Fx"');
    expect(html).toContain("Sign in to add this title to your library");
    expect(html).not.toContain("Add to my library");
  });
});

describe("the library block of the title page while a change is on its way", () => {
  const sending = (
    action: string,
    fields: Record<string, string>,
    library: Record<string, unknown>,
  ) => renderSending(action, fields, <MediaDetail {...detailProps(library)} />);

  it("shows a title that is being added as planned at once, with the buttons off", async () => {
    const html = await sending(
      "/library/add",
      { mediaId },
      {
        signedIn: true,
        status: null,
        progress: 0,
        totalEpisodes: 12,
        progressUnit: null,
        progressTotal: null,
      },
    );

    expect(html).toContain("En tu biblioteca");
    expect(html).not.toContain("Añadir a mi biblioteca");
    expect(html).toMatch(/<button[^>]*value="planned"[^>]*aria-pressed="true"/);
    for (const button of html.match(/<button[^>]*name="status"[^>]*>/g) ?? []) {
      expect(button).toContain('disabled=""');
    }
  });

  it("shows the status that was pressed at once", async () => {
    const html = await sending(
      `/library/${mediaId}/status`,
      { status: "dropped" },
      inLibrary(),
    );

    const pressed = (
      html.match(/<button[^>]*aria-pressed="true"[^>]*>/g) ?? []
    ).join("");
    expect(pressed).toContain('value="dropped"');
    expect(pressed).not.toContain('value="in_progress"');
  });

  it("shows a completed title with all its episodes at once", async () => {
    const html = await sending(
      `/library/${mediaId}/status`,
      { status: "completed" },
      inLibrary(),
    );

    expect(html).toContain("12 de 12 episodios");
    expect(html).not.toContain(`/library/${mediaId}/step`);
  });

  it("shows one more at once with the step, and turns off the button", async () => {
    const html = await sending(`/library/${mediaId}/step`, {}, inLibrary());

    expect(html).toContain("4 de 12 episodios");
    expect(html).toContain('value="4"');
    const step =
      /<button[^>]*aria-label="\+1[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    expect(step).toContain('disabled=""');
  });

  it("completes the title at once with the last step, and takes the +1 away", async () => {
    const html = await sending(
      `/library/${mediaId}/step`,
      {},
      inLibrary({ progress: 11 }),
    );

    expect(html).toContain("12 de 12 episodios");
    expect(html).toMatch(
      /<button[^>]*value="completed"[^>]*aria-pressed="true"/,
    );
    expect(html).not.toContain('aria-label="+1');
  });
});
