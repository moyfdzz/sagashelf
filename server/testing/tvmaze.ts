import { http, HttpResponse } from "msw";

/**
 * TVmaze fixtures and handlers for the tests, shaped like the real answers of
 * `GET /shows/<id>?embed=nextepisode` (read 2026-10-30 for The Simpsons, id 83, with its next
 * episode, and for Attack on Titan, id 919, which is over), cut down to the fields the adapter
 * reads (the id of the episode is made up). `tvmazeHandlers()` goes into `mswServer.use(...)`.
 */
export const tvmazeBase = "https://api.tvmaze.com";

export const simpsonsId = 83;
export const titanId = 919;
export const missingId = 424242;
export const limitedId = 429429;

export const simpsons = {
  id: simpsonsId,
  name: "The Simpsons",
  status: "Running",
  _embedded: {
    nextepisode: {
      id: 3_000_001,
      name: "Testing 1-2-3",
      season: 38,
      number: 5,
      airdate: "2026-11-01",
      airstamp: "2026-11-02T01:00:00+00:00",
    },
  },
};

export const attackOnTitan = {
  id: titanId,
  name: "Attack on Titan",
  status: "Ended",
};

export type SeenShow = { id: string; url: URL; headers: Headers };

export function tvmazeHandlers(seen: SeenShow[] = []) {
  return [
    http.get(`${tvmazeBase}/shows/:id`, ({ request, params }) => {
      seen.push({
        id: String(params.id),
        url: new URL(request.url),
        headers: request.headers,
      });
      if (params.id === String(simpsonsId)) return HttpResponse.json(simpsons);
      if (params.id === String(titanId)) {
        return HttpResponse.json(attackOnTitan);
      }
      if (params.id === String(limitedId)) {
        return new HttpResponse(null, {
          status: 429,
          headers: { "Retry-After": "5" },
        });
      }
      return HttpResponse.json({ status: 404 }, { status: 404 });
    }),
  ];
}
