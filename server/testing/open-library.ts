import { http, HttpResponse } from "msw";

/**
 * Open Library fixtures and handlers for the tests, shaped like the real API (answers recorded on
 * 2026-10-28, and the Spanish editions on 2026-10-29, cut down to the fields the adapter reads). `openLibraryHandlers()` goes into
 * `mswServer.use(...)`.
 */
export const openLibraryBase = "https://openlibrary.org";

export const dune = {
  author_name: ["Frank Herbert"],
  cover_i: 11481354,
  edition_count: 155,
  first_publish_year: 1965,
  key: "/works/OL893414W",
  language: ["eng", "spa"],
  title: "Dune",
};

export const duneMessiah = {
  author_name: ["Frank Herbert"],
  cover_i: 980253,
  edition_count: 101,
  first_publish_year: 1969,
  key: "/works/OL893461W",
  language: ["eng", "spa"],
  title: "Dune Messiah",
};

/** A work with Spanish editions whose title Open Library gives only in English. */
export const butterflyGarden = {
  author_name: ["Dot Hutchison"],
  edition_count: 11,
  first_publish_year: 2016,
  key: "/works/OL20036652W",
  language: ["por", "spa", "eng"],
  title: "The Butterfly Garden",
};

/** What the search says is the Spanish edition of each work, one per work and sometimes noisy. */
export const spanishMatches: Record<string, string> = {
  "/works/OL893414W": "Dune / Duna",
  "/works/OL893461W": "El messies de Dune",
  "/works/OL20036652W": "El Jardín de Las Mariposas",
};

/** The editions of the butterfly garden work, as recorded (3 of 11 say they are in Spanish). */
export const butterflyEditions = {
  size: 11,
  entries: [
    {
      title: "O jardim das borboletas",
      languages: [{ key: "/languages/por" }],
    },
    { title: "Kelebek Bahçesi", languages: [] },
    {
      title: "El Jardín de Las Mariposas",
      languages: [{ key: "/languages/spa" }],
    },
    { title: "Butterfly Garden, The", languages: [] },
    {
      title: "El jardín de las mariposas",
      languages: [{ key: "/languages/spa" }],
    },
    {
      title: "El jardín de las mariposas",
      languages: [{ key: "/languages/spa" }],
    },
    { title: "The Butterfly Garden", languages: [{ key: "/languages/eng" }] },
  ],
};

/** The same book filed as a second work, with fewer editions. */
export const duneDuplicate = {
  author_name: ["Frank Herbert"],
  edition_count: 3,
  first_publish_year: 1966,
  key: "/works/OL1234567W",
  title: "Dune",
};

export const duneWork = {
  title: "Dune",
  key: "/works/OL893414W",
  type: { key: "/type/work" },
  description:
    "Set on the desert planet Arrakis.\r\n\r\nA stunning blend of adventure and mysticism.",
  covers: [-1, 11481354, 12375564],
  // Free text, with the noise it usually has.
  subjects: [
    "Fiction",
    "Science fiction",
    "Adventure stories",
    "Juvenile literature",
    "Ecology -- Fiction",
    "Imaginary places",
  ],
};

export type SeenRequest = { url: URL; headers: Headers };

/**
 * Handlers for the endpoints the adapter uses. `seen` collects the requests, so a test can check
 * the query, the language and the `User-Agent` that were sent.
 */
export function openLibraryHandlers(seen: SeenRequest[] = []) {
  const record = (request: { url: string; headers: Headers }) =>
    seen.push({ url: new URL(request.url), headers: request.headers });

  return [
    http.get(`${openLibraryBase}/search.json`, ({ request }) => {
      record(request);
      const q = new URL(request.url).searchParams.get("q") ?? "";
      // The titles in Spanish: only the works asked for, each with the edition that matched.
      if (q.endsWith(") AND language:spa")) {
        const docs = Object.entries(spanishMatches)
          .filter(([key]) => q.includes(`key:${key}`))
          .map(([key, title]) => ({
            key,
            editions: { docs: [{ title, language: ["spa"] }] },
          }));
        return HttpResponse.json({ numFound: docs.length, docs });
      }
      if (q === "key:/works/OL20036652W") {
        return HttpResponse.json({ numFound: 1, docs: [butterflyGarden] });
      }
      if (q === "key:/works/OL893414W") {
        return HttpResponse.json({ numFound: 1, docs: [dune] });
      }
      if (q === "key:/works/OL999W") return HttpResponse.json({ docs: [] });
      if (q === "isbn:9780441172719") {
        return HttpResponse.json({ numFound: 1, docs: [dune] });
      }
      if (q === "qzxwvkjhgfdsa") return HttpResponse.json({ docs: [] });
      return HttpResponse.json({
        numFound: 4,
        docs: [dune, duneMessiah, duneDuplicate],
      });
    }),
    http.get(`${openLibraryBase}/works/OL893414W.json`, ({ request }) => {
      record(request);
      return HttpResponse.json(duneWork);
    }),
    http.get(`${openLibraryBase}/works/OL20036652W.json`, ({ request }) => {
      record(request);
      return HttpResponse.json({
        title: "The Butterfly Garden",
        key: "/works/OL20036652W",
        type: { key: "/type/work" },
        description: "A girl escapes from a garden of butterflies.",
        covers: [8123456],
      });
    }),
    http.get(
      `${openLibraryBase}/works/OL20036652W/editions.json`,
      ({ request }) => {
        record(request);
        return HttpResponse.json(butterflyEditions);
      },
    ),
    http.get(
      `${openLibraryBase}/works/OL893414W/editions.json`,
      ({ request }) => {
        record(request);
        return HttpResponse.json({
          entries: [
            { title: "Dune", languages: [{ key: "/languages/spa" }] },
            { title: "Dune / Duna", languages: [{ key: "/languages/spa" }] },
          ],
        });
      },
    ),
    http.get(`${openLibraryBase}/works/OL999W.json`, ({ request }) => {
      record(request);
      return HttpResponse.json({
        title: "No search entry",
        key: "/works/OL999W",
        type: { key: "/type/work" },
        description: { type: "/type/text", value: "From the work only." },
        covers: [-1, 42],
      });
    }),
    http.get(`${openLibraryBase}/works/OL893415W.json`, ({ request }) => {
      record(request);
      return HttpResponse.json({
        key: "/works/OL893415W",
        type: { key: "/type/redirect" },
        location: "/works/OL893414W",
      });
    }),
    http.get(`${openLibraryBase}/works/OL1W.json`, ({ request }) => {
      record(request);
      return HttpResponse.json({ error: "notfound" }, { status: 404 });
    }),
  ];
}
