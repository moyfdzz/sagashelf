/**
 * Wikidata (CC0) through its SPARQL endpoint (SAG-16, ADR-025). The ids of the properties were
 * read from the Wikidata API on 2026-10-30, and the classes of the formats from the same API.
 */

/** The ids a title has in a source we use, as Wikidata names them. */
export type WikidataScheme =
  "tmdb_movie" | "tmdb_tv" | "mal_manga" | "anilist_manga" | "open_library";

export const schemes: readonly WikidataScheme[] = [
  "tmdb_movie",
  "tmdb_tv",
  "mal_manga",
  "anilist_manga",
  "open_library",
];

const propertyOfScheme: Record<WikidataScheme, string> = {
  tmdb_movie: "P4947",
  tmdb_tv: "P4983",
  mal_manga: "P4087",
  anilist_manga: "P8731",
  open_library: "P648",
};

/** What each id looks like. A value that does not match is never put in a query. */
const valueShape: Record<WikidataScheme, RegExp> = {
  tmdb_movie: /^[0-9]{1,9}$/,
  tmdb_tv: /^[0-9]{1,9}$/,
  mal_manga: /^[0-9]{1,9}$/,
  anilist_manga: /^[0-9]{1,9}$/,
  open_library: /^OL[0-9]{1,12}W$/,
};

export type WikidataSource = { scheme: WikidataScheme; value: string };

export const wikidataFormats = [
  "anime",
  "movie",
  "series",
  "manga",
  "book",
  "game",
  "franchise",
  "other",
] as const;
export type WikidataFormat = (typeof wikidataFormats)[number];

export const isWikidataFormat = (value: unknown): value is WikidataFormat =>
  typeof value === "string" &&
  (wikidataFormats as readonly string[]).includes(value);

/** The classes (`instance of`) that tell the format of an item, by their labels in Wikidata. */
const formatOfClass: Record<string, WikidataFormat> = {
  Q63952888: "anime", // anime television series
  Q20650540: "anime", // anime film
  Q220898: "anime", // original video animation
  Q1107: "anime",
  Q11424: "movie", // film
  Q24862: "movie", // short film
  Q1257444: "movie", // film adaptation
  Q5398426: "series", // television series
  Q117467246: "series", // animated television series
  Q1259759: "series", // miniseries
  Q15416: "series", // television program
  Q21198342: "manga", // manga series
  Q8274: "manga",
  Q7725634: "book", // literary work
  Q47461344: "book", // written work
  Q104213567: "book", // light novel series
  Q747381: "book", // light novel
  Q1667921: "book", // novel series
  Q277759: "book", // book series
  Q8261: "book", // novel
  Q1004: "book", // comic
  Q7889: "game", // video game
  Q7058673: "game", // video game series
  Q196600: "franchise", // media franchise
};

/** The format of an item from its classes, the first known one in this order. */
export function formatOfClasses(classes: readonly string[]): WikidataFormat {
  const known = classes
    .map((qid) => formatOfClass[qid])
    .filter((format): format is WikidataFormat => format !== undefined);
  for (const format of wikidataFormats) {
    if (known.includes(format)) return format;
  }
  return "other";
}

const qidShape = /^Q[0-9]{1,12}$/;

/** `http://www.wikidata.org/entity/Q42` or `Q42` as `Q42`, or null. */
export function qidOf(value: string | undefined): string | null {
  const qid = value?.split("/").pop() ?? "";
  return qidShape.test(qid) ? qid : null;
}

const qidsOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(" ")
    .map((part) => qidOf(part))
    .filter((qid): qid is string => qid !== null);

/** One item, in the shape we keep it. */
export type WikidataItem = {
  qid: string;
  labels: { es?: string; en?: string };
  format: WikidataFormat;
  ids: Partial<Record<WikidataScheme, string>>;
  /** The media franchises it belongs to (`P8345`). */
  franchises: string[];
  /** The works it is based on (`P144`). Only the lookup of a title asks for these. */
  basedOn: string[];
  /**
   * The year it came out (the first of `P577` publication date or `P580` start time). Only the
   * members query asks for it; null there says Wikidata has no date.
   */
  year?: number | null;
  /** True for an item the members query described, which is the one that says its year. */
  detailed?: boolean;
};

/** A SPARQL answer, reduced to what is read. */
export type SparqlResult = {
  results?: {
    bindings?: Record<string, { value?: string } | undefined>[];
  };
};

const bindingText = (
  row: Record<string, { value?: string } | undefined>,
  name: string,
): string | undefined => {
  const value = row[name]?.value?.trim();
  return value ? value : undefined;
};

const prefixes = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;

/** The sources whose value has the right shape, without repeats. */
export function validSources(
  sources: readonly WikidataSource[],
): WikidataSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.scheme}:${source.value}`;
    if (seen.has(key) || !valueShape[source.scheme]?.test(source.value)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * One query that finds the item of every source at once, with its labels, its franchises and the
 * works it is based on. A source with a value that does not look like an id is left out, so
 * nothing but a plain id ever reaches the query text.
 */
export function buildLookupQuery(
  sources: readonly WikidataSource[],
): string | null {
  const valid = validSources(sources);
  if (valid.length === 0) return null;
  const blocks = schemes.flatMap((scheme) => {
    const values = valid
      .filter((source) => source.scheme === scheme)
      .map((source) => `"${source.value}"`);
    return values.length === 0
      ? []
      : [
          `{ VALUES ?value { ${values.join(" ")} } ?item wdt:${propertyOfScheme[scheme]} ?value . BIND("${scheme}" AS ?scheme) }`,
        ];
  });
  return `${prefixes}
SELECT ?scheme ?value ?item
  (SAMPLE(?es) AS ?labelEs) (SAMPLE(?en) AS ?labelEn)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?fr), "entity/"); separator=" ") AS ?franchises)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?base), "entity/"); separator=" ") AS ?basedOn)
WHERE {
  ${blocks.join("\n  UNION\n  ")}
  OPTIONAL { ?item wdt:P8345 ?fr }
  OPTIONAL { ?item wdt:P144 ?base }
  OPTIONAL { ?item rdfs:label ?es . FILTER(LANG(?es) = "es") }
  OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
}
GROUP BY ?scheme ?value ?item
LIMIT 200`;
}

/** The item each source resolved to. A source Wikidata does not know has no entry. */
export type LookupHit = { source: WikidataSource; item: WikidataItem };

export function parseLookup(answer: SparqlResult): LookupHit[] {
  const hits: LookupHit[] = [];
  for (const row of answer.results?.bindings ?? []) {
    const scheme = bindingText(row, "scheme") as WikidataScheme | undefined;
    const value = bindingText(row, "value");
    const qid = qidOf(bindingText(row, "item"));
    if (!scheme || !value || !qid || !valueShape[scheme]?.test(value)) continue;
    hits.push({
      source: { scheme, value },
      item: {
        qid,
        labels: labelsOf(row),
        // The format of the title we looked up is the one of our own catalog; the job sets it.
        format: "other",
        ids: { [scheme]: value },
        franchises: qidsOf(bindingText(row, "franchises")),
        basedOn: qidsOf(bindingText(row, "basedOn")),
      },
    });
  }
  return hits;
}

function labelsOf(row: Record<string, { value?: string } | undefined>) {
  const es = bindingText(row, "labelEs");
  const en = bindingText(row, "labelEn");
  return { ...(es ? { es } : {}), ...(en ? { en } : {}) };
}

/** The most items one query about franchises brings back. */
export const membersLimit = 400;

/**
 * One query for the members of the franchises and the items some titles are based on: their
 * labels, classes and the ids we can match to our catalog. The franchise itself comes back too.
 */
export function buildMembersQuery(
  franchises: readonly string[],
  extra: readonly string[],
): string | null {
  const franchiseList = franchises.filter((qid) => qidShape.test(qid));
  const extraList = extra.filter((qid) => qidShape.test(qid));
  if (franchiseList.length === 0 && extraList.length === 0) return null;
  const wd = (qids: readonly string[]) =>
    qids.map((qid) => `wd:${qid}`).join(" ");
  const direct = [...new Set([...franchiseList, ...extraList])];
  const branches = [
    ...(franchiseList.length > 0
      ? [`{ VALUES ?fr { ${wd(franchiseList)} } ?member wdt:P8345 ?fr . }`]
      : []),
    `{ VALUES ?member { ${wd(direct)} } OPTIONAL { ?member wdt:P8345 ?fr } }`,
  ];
  return `${prefixes}
SELECT ?member
  (SAMPLE(?es) AS ?labelEs) (SAMPLE(?en) AS ?labelEn)
  (MIN(YEAR(?date)) AS ?year)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator=" ") AS ?classes)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?fr), "entity/"); separator=" ") AS ?franchises)
  (SAMPLE(?tmdbMovie) AS ?idTmdbMovie) (SAMPLE(?tmdbTv) AS ?idTmdbTv)
  (SAMPLE(?malManga) AS ?idMalManga) (SAMPLE(?alManga) AS ?idAlManga)
  (SAMPLE(?openLibrary) AS ?idOpenLibrary)
WHERE {
  ${branches.join("\n  UNION\n  ")}
  OPTIONAL { ?member rdfs:label ?es . FILTER(LANG(?es) = "es") }
  OPTIONAL { ?member rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?member wdt:P31 ?class }
  OPTIONAL { ?member wdt:P577 ?published }
  OPTIONAL { ?member wdt:P580 ?started }
  BIND(COALESCE(?published, ?started) AS ?date)
  OPTIONAL { ?member wdt:P4947 ?tmdbMovie }
  OPTIONAL { ?member wdt:P4983 ?tmdbTv }
  OPTIONAL { ?member wdt:P4087 ?malManga }
  OPTIONAL { ?member wdt:P8731 ?alManga }
  OPTIONAL { ?member wdt:P648 ?openLibrary }
}
GROUP BY ?member
LIMIT ${membersLimit}`;
}

export function parseMembers(answer: SparqlResult): WikidataItem[] {
  const items: WikidataItem[] = [];
  for (const row of answer.results?.bindings ?? []) {
    const qid = qidOf(bindingText(row, "member"));
    if (!qid) continue;
    const ids: WikidataItem["ids"] = {};
    const idColumns: [WikidataScheme, string][] = [
      ["tmdb_movie", "idTmdbMovie"],
      ["tmdb_tv", "idTmdbTv"],
      ["mal_manga", "idMalManga"],
      ["anilist_manga", "idAlManga"],
      ["open_library", "idOpenLibrary"],
    ];
    for (const [scheme, column] of idColumns) {
      const value = bindingText(row, column);
      if (value && valueShape[scheme].test(value)) ids[scheme] = value;
    }
    const year = Number(bindingText(row, "year"));
    items.push({
      qid,
      labels: labelsOf(row),
      format: formatOfClasses(qidsOf(bindingText(row, "classes"))),
      ids,
      franchises: qidsOf(bindingText(row, "franchises")),
      basedOn: [],
      year:
        Number.isInteger(year) && year >= 1000 && year <= 2200 ? year : null,
      detailed: true,
    });
  }
  return items;
}
