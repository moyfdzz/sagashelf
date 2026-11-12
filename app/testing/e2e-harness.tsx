/**
 * Mounts one component alone in a page, for the keyboard and focus tests of `e2e/components.spec.ts`
 * (SAG-251). The pages that hold these components need a session, which the E2E job cannot have, so
 * each one is drawn here with a router and the texts of the app, and driven in a real Chromium.
 * `e2e/harness/global-setup.ts` bundles this file; nothing in the app imports it.
 */
import { createInstance } from "i18next";
import { createRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  type LoaderFunctionArgs,
} from "react-router";

import { AccountMenu } from "~/components/AccountMenu";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { NotesPreview } from "~/components/NotesPreview";
import { SearchBox } from "~/components/SearchBox";
import { resources } from "~/locales";

export type HarnessName = "confirm" | "notes" | "account" | "search";

const longNote = Array.from(
  { length: 30 },
  (_, i) => `Línea ${i + 1} de una nota larga.`,
).join("\n");

const titles = ["Naruto", "Naruto Shippuden", "Boruto"];

/** The answer of the search route to the suggestions, as the real loader shapes it. */
function searchLoader({ request }: LoaderFunctionArgs) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  return {
    q,
    results:
      q.length < 2
        ? []
        : titles.map((title, index) => ({
            provider: "tmdb",
            externalId: `tv/${index}`,
            title,
            year: 2002 + index,
          })),
  };
}

function Page({ name }: { name: HarnessName }) {
  const location = useLocation();
  const confirmOpen = new URLSearchParams(location.search).has("confirm");
  return (
    <main className="space-y-4 p-6">
      <button type="button" id="before">
        Antes
      </button>
      <p data-testid="where">{`${location.pathname}${location.search}`}</p>
      {name === "confirm" && confirmOpen ? (
        <ConfirmDialog
          title="¿Eliminar esta entrada?"
          message="Se quitará de tu biblioteca."
          cancelHref="/entry"
          cancelLabel="Cancelar"
        >
          <button type="button">Eliminar</button>
        </ConfirmDialog>
      ) : null}
      {name === "notes" ? (
        <NotesPreview
          title="Naruto"
          notes={longNote}
          entryHref="/library/abc"
        />
      ) : null}
      {name === "account" ? <AccountMenu username="ana_reads" /> : null}
      {name === "search" ? (
        <SearchBox initialQuery="" type={undefined} />
      ) : null}
      <button type="button" id="after">
        Después
      </button>
    </main>
  );
}

async function mountHarness(name: HarnessName) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter(
    [
      { path: "/search", loader: searchLoader, element: <Page name={name} /> },
      { path: "*", element: <Page name={name} /> },
    ],
    {
      initialEntries: [name === "confirm" ? "/entry?confirm=1" : "/entry"],
    },
  );
  const host = document.getElementById("root");
  if (!host) throw new Error("The page has no #root");
  createRoot(host).render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

(window as unknown as { mountHarness: typeof mountHarness }).mountHarness =
  mountHarness;
