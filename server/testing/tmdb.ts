import { http, HttpResponse } from "msw";

/**
 * TMDB fixtures and handlers for the tests, shaped like the real API (fields cut down to the
 * ones the adapter reads). `tmdbHandlers()` goes into `mswServer.use(...)`.
 */
export const tmdbBase = "https://api.themoviedb.org/3";

export const matrix = {
  id: 603,
  title: "Matrix",
  original_title: "The Matrix",
  overview: "Un programador descubre la verdad sobre su mundo.",
  poster_path: "/matrix.jpg",
  release_date: "1999-03-30",
  popularity: 85.5,
  genre_ids: [28, 878],
  original_language: "en",
};

export const yourName = {
  id: 372058,
  title: "Your Name.",
  original_title: "君の名は。",
  overview: "Dos jóvenes intercambian cuerpos.",
  poster_path: "/yourname.jpg",
  release_date: "2016-08-26",
  popularity: 60,
  genre_ids: [16, 18, 10749],
  original_language: "ja",
};

export const breakingBad = {
  id: 1396,
  name: "Breaking Bad",
  original_name: "Breaking Bad",
  overview: "Un profesor de química se vuelve fabricante.",
  poster_path: "/bb.jpg",
  first_air_date: "2008-01-20",
  popularity: 300,
  genre_ids: [18, 80],
  origin_country: ["US"],
  original_language: "en",
};

export const attackOnTitan = {
  id: 1429,
  name: "Ataque a los Titanes",
  original_name: "進撃の巨人",
  overview: "La humanidad vive tras enormes muros.",
  poster_path: "/aot.jpg",
  first_air_date: "2013-04-07",
  popularity: 250,
  genre_ids: [16, 10759],
  origin_country: ["JP"],
  original_language: "ja",
};

/** An animated series made in the US: Animation, but not anime. */
export const rickAndMorty = {
  id: 60625,
  name: "Rick y Morty",
  original_name: "Rick and Morty",
  overview: "Un científico y su nieto.",
  poster_path: null,
  first_air_date: "2013-12-02",
  popularity: 200,
  genre_ids: [16, 35],
  origin_country: ["US"],
  original_language: "en",
};

export const attackDetails = {
  ...attackOnTitan,
  genre_ids: undefined,
  genres: [{ id: 16 }, { id: 10759 }],
  status: "Ended",
  seasons: [
    { season_number: 0, name: "Especiales", air_date: null },
    { season_number: 1, name: "Temporada 1", air_date: "2013-04-07" },
    { season_number: 2, name: "Temporada 2", air_date: "2017-04-01" },
  ],
};

export const seasonDetails = {
  "season/0": {
    season_number: 0,
    name: "Especiales",
    air_date: null,
    episodes: [{ episode_number: 1, name: "Resumen", air_date: null }],
  },
  "season/1": {
    season_number: 1,
    name: "Temporada 1",
    air_date: "2013-04-07",
    episodes: [
      {
        episode_number: 1,
        name: "A ti, dentro de 2000 años",
        air_date: "2013-04-07",
      },
      { episode_number: 2, name: "Ese día", air_date: "2013-04-14" },
    ],
  },
  "season/2": {
    season_number: 2,
    name: "Temporada 2",
    air_date: "2017-04-01",
    episodes: [
      { episode_number: 1, name: "Bestia Titán", air_date: "2017-04-01" },
    ],
  },
};

export type SeenRequest = { url: URL; headers: Headers };

/**
 * Handlers for the endpoints the adapter uses. `seen` collects the requests, so a test can check
 * the language, the query and the headers that were sent.
 */
export function tmdbHandlers(seen: SeenRequest[] = []) {
  const record = (request: { url: string; headers: Headers }) =>
    seen.push({ url: new URL(request.url), headers: request.headers });

  return [
    http.get(`${tmdbBase}/search/movie`, ({ request }) => {
      record(request);
      return HttpResponse.json({ results: [matrix, yourName] });
    }),
    http.get(`${tmdbBase}/search/tv`, ({ request }) => {
      record(request);
      return HttpResponse.json({
        results: [breakingBad, attackOnTitan, rickAndMorty],
      });
    }),
    http.get(`${tmdbBase}/movie/603`, ({ request }) => {
      record(request);
      return HttpResponse.json({
        ...matrix,
        genre_ids: undefined,
        genres: [{ id: 28 }],
        status: "Released",
      });
    }),
    http.get(`${tmdbBase}/movie/999999`, ({ request }) => {
      record(request);
      return HttpResponse.json({ status_code: 34 }, { status: 404 });
    }),
    http.get(`${tmdbBase}/tv/1429`, ({ request }) => {
      record(request);
      const append = new URL(request.url).searchParams.get(
        "append_to_response",
      );
      if (!append) return HttpResponse.json(attackDetails);
      const wanted = append.split(",");
      return HttpResponse.json({
        ...attackDetails,
        ...Object.fromEntries(
          Object.entries(seasonDetails).filter(([key]) => wanted.includes(key)),
        ),
      });
    }),
    http.get(`${tmdbBase}/trending/:path/:window`, ({ request, params }) => {
      record(request);
      if (params.path === "all") {
        return HttpResponse.json({
          results: [
            { ...matrix, media_type: "movie" },
            { ...attackOnTitan, media_type: "tv" },
            { id: 1, name: "Someone", media_type: "person" },
          ],
        });
      }
      return HttpResponse.json({
        results:
          params.path === "movie"
            ? [matrix, yourName]
            : [breakingBad, attackOnTitan],
      });
    }),
  ];
}
