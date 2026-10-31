import { http, HttpResponse } from "msw";

import type { MangadexManga } from "../providers/mangadex/map";

/**
 * MangaDex fixtures and handlers for the tests, shaped like the real API (answers recorded on
 * 2026-10-28, cut down to the fields the adapter reads; the ids of `berserk` and `adult` are made
 * up). `mangadexHandlers()` goes into `mswServer.use(...)`.
 */
export const mangadexBase = "https://api.mangadex.org";

export const berserkId = "00000000-0000-4000-8000-000000000001";
export const vrmmoId = "b00acc54-2bf1-440e-8f33-da87227d82d6";
export const adultId = "00000000-0000-4000-8000-0000000000ad";

/** The title is in romaji, the English one is an alternative title, as MangaDex sends them. */
export const berserk: MangadexManga = {
  id: berserkId,
  type: "manga",
  attributes: {
    title: { "ja-ro": "Berserk" },
    altTitles: [
      { ja: "ベルセルク" },
      { en: "Berserk" },
      { es: "Berserk (edición en español)" },
    ],
    description: {
      en: "Guts, a former mercenary, hunts demons.\n\n---\n\n**Additional links:** [Official](https://example.test)",
      "es-la": "Guts, un ex mercenario, caza demonios.",
    },
    originalLanguage: "ja",
    status: "ongoing",
    year: 1989,
    contentRating: "suggestive",
    // The ids in other catalogs, as MangaDex sends them (read 2026-10-30).
    links: { al: "30002", mal: "2" },
    // As MangaDex sends them (names read 2026-10-30): genres and themes, and a tag of the groups
    // `format` and `content`, which are never read.
    tags: [
      { attributes: { name: { en: "Action" }, group: "genre" } },
      { attributes: { name: { en: "Adventure" }, group: "genre" } },
      { attributes: { name: { en: "Demons" }, group: "theme" } },
      { attributes: { name: { en: "Drama" }, group: "genre" } },
      { attributes: { name: { en: "Fantasy" }, group: "genre" } },
      { attributes: { name: { en: "Horror" }, group: "genre" } },
      { attributes: { name: { en: "Psychological" }, group: "genre" } },
      { attributes: { name: { en: "Tragedy" }, group: "genre" } },
      { attributes: { name: { en: "Gore" }, group: "content" } },
      { attributes: { name: { en: "Award Winning" }, group: "format" } },
    ],
  },
  relationships: [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      type: "author",
      attributes: { name: "Miura Kentarou" },
    },
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      type: "artist",
      attributes: { name: "Miura Kentarou" },
    },
    {
      id: "00000000-0000-4000-8000-0000000000c1",
      type: "cover_art",
      attributes: { fileName: "11111111-2222-4333-8444-555555555555.jpg" },
    },
    { id: vrmmoId, type: "manga" },
  ],
};

/** A real answer: the title is already in English, the cover is a PNG, author and artist match. */
export const vrmmo: MangadexManga = {
  id: vrmmoId,
  type: "manga",
  attributes: {
    title: {
      en: "VRMMO Chronicles of a Solo Cleric ~Surprise! I’m Actually a Berserker!~",
    },
    altTitles: [
      {
        en: "VRMMO Chronicles of a Solo Cleric ~No Matter How You Look At It, It's a Berserker! Thank You So Much~",
      },
    ],
    description: {
      en: "A high schooler plays a VRMMORPG.\n\n---\n\nNote: typo",
    },
    originalLanguage: "ja",
    status: "completed",
    year: 2023,
    contentRating: "safe",
  },
  relationships: [
    {
      id: "f003a5ec-4b59-491d-b7a6-550910fd5c63",
      type: "author",
      attributes: { name: "Digishoku" },
    },
    {
      id: "f003a5ec-4b59-491d-b7a6-550910fd5c63",
      type: "artist",
      attributes: { name: "Digishoku" },
    },
    {
      id: "3b5f0206-e292-466d-93f5-f9f2ebf63f32",
      type: "cover_art",
      attributes: { fileName: "fac369b9-c8f3-4fa2-b9da-f2fab0a9ca35.png" },
    },
  ],
};

/** Something the API would not return for the ratings we ask for; the adapter checks anyway. */
export const adult: MangadexManga = {
  id: adultId,
  type: "manga",
  attributes: {
    title: { en: "Adults only" },
    altTitles: [],
    description: {},
    originalLanguage: "ja",
    status: "ongoing",
    year: 2020,
    contentRating: "pornographic",
  },
  relationships: [],
};

export type SeenRequest = { url: URL; headers: Headers };

/**
 * Handlers for the endpoints the adapter uses. `seen` collects the requests, so a test can check
 * the query, the ratings and the `User-Agent` that were sent.
 */
export function mangadexHandlers(seen: SeenRequest[] = []) {
  const record = (request: { url: string; headers: Headers }) =>
    seen.push({ url: new URL(request.url), headers: request.headers });

  return [
    http.get(`${mangadexBase}/manga`, ({ request }) => {
      record(request);
      const title = new URL(request.url).searchParams.get("title");
      if (title === "qzxwvkjhgfdsa") return HttpResponse.json({ data: [] });
      if (title === "berserk") {
        return HttpResponse.json({ data: [berserk, vrmmo, adult] });
      }
      return HttpResponse.json({ data: [berserk] });
    }),
    http.get(`${mangadexBase}/manga/:id`, ({ request, params }) => {
      record(request);
      if (params.id === berserkId) return HttpResponse.json({ data: berserk });
      if (params.id === adultId) return HttpResponse.json({ data: adult });
      return HttpResponse.json({ result: "error" }, { status: 404 });
    }),
  ];
}
