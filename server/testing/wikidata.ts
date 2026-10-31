import { http, HttpResponse } from "msw";

import type { SparqlResult } from "../providers/wikidata/map";

/**
 * Wikidata fixtures and handlers for the tests, shaped like the answers of the SPARQL endpoint
 * (read 2026-10-30 for the franchise of Attack on Titan, cut down to a few members). The handler
 * tells the two queries apart by their text. `wikidataHandlers()` goes into `mswServer.use(...)`.
 */
export const wikidataEndpoint = "https://query.wikidata.org/sparql";

const entity = "http://www.wikidata.org/entity/";
const cell = (value: string) => ({ type: "literal", value });
const uri = (qid: string) => ({ type: "uri", value: `${entity}${qid}` });

export const animeQid = "Q22126305";
export const mangaQid = "Q586025";
export const filmQid = "Q20313191";
export const franchiseQid = "Q106712785";

/** The lookup of the anime (TMDB series 1429), which belongs to the franchise and is based on the manga. */
export const lookupAnswer: SparqlResult = {
  results: {
    bindings: [
      {
        scheme: cell("tmdb_tv"),
        value: cell("1429"),
        item: uri(animeQid),
        labelEs: cell("Ataque a los Titanes"),
        labelEn: cell("Attack on Titan"),
        franchises: cell(franchiseQid),
        basedOn: cell(mangaQid),
      },
    ],
  },
};

/** The members of the franchise, and the franchise itself. */
export const membersAnswer: SparqlResult = {
  results: {
    bindings: [
      {
        member: uri(mangaQid),
        labelEs: cell("Ataque a los Titanes"),
        labelEn: cell("Attack on Titan"),
        classes: cell("Q21198342"),
        franchises: cell(franchiseQid),
        idMalManga: cell("23390"),
        idAlManga: cell("53390"),
      },
      {
        member: uri(filmQid),
        labelEs: cell("Attack on Titan"),
        labelEn: cell("Attack on Titan"),
        classes: cell("Q11424"),
        franchises: cell(franchiseQid),
        idTmdbMovie: cell("295830"),
      },
      {
        member: uri("Q20800425"),
        labelEn: cell("Attack on Titan: Humanity in Chains"),
        classes: cell("Q7889"),
        franchises: cell(franchiseQid),
      },
      {
        member: uri(animeQid),
        labelEs: cell("Ataque a los Titanes"),
        labelEn: cell("Attack on Titan"),
        classes: cell("Q63952888"),
        franchises: cell(franchiseQid),
        idTmdbTv: cell("1429"),
      },
      {
        member: uri(franchiseQid),
        labelEn: cell("Attack on Titan"),
        classes: cell("Q196600"),
        franchises: cell(""),
      },
    ],
  },
};

export type SeenQuery = { query: string; headers: Headers };

export function wikidataHandlers(seen: SeenQuery[] = []) {
  return [
    http.get(wikidataEndpoint, ({ request }) => {
      const query = new URL(request.url).searchParams.get("query") ?? "";
      seen.push({ query, headers: request.headers });
      return HttpResponse.json(
        query.includes("?scheme") ? lookupAnswer : membersAnswer,
      );
    }),
  ];
}
