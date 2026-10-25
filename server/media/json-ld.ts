import type { MediaKind } from "../providers/types";

export type JsonLdInput = {
  type: MediaKind;
  /** The source id: TMDB marks a movie `movie/603` and a series `tv/1396`. */
  externalId: string;
  title: string;
  originalTitle: string | null;
  description: string | null;
  year: number | null;
  /** Absolute addresses. */
  url: string;
  image: string | null;
  seasonCount: number;
};

/** The schema.org type for one of our kinds. Anime is a movie or a series, as its source says. */
function schemaType(type: MediaKind, externalId: string): string {
  if (type === "book" || type === "manga") return "Book";
  if (type === "movie") return "Movie";
  if (type === "series") return "TVSeries";
  return externalId.startsWith("movie/") ? "Movie" : "TVSeries";
}

/** The structured data for sharing and search engines: only what the page itself shows. */
export function buildJsonLd(input: JsonLdInput): Record<string, unknown> {
  const type = schemaType(input.type, input.externalId);
  return {
    "@context": "https://schema.org",
    "@type": type,
    name: input.title,
    url: input.url,
    ...(input.originalTitle ? { alternateName: input.originalTitle } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.image ? { image: input.image } : {}),
    ...(input.year ? { datePublished: String(input.year) } : {}),
    ...(type === "TVSeries" && input.seasonCount > 0
      ? { numberOfSeasons: input.seasonCount }
      : {}),
  };
}

/** A short text for the preview of a link: the synopsis cut at a word, with an ellipsis. */
export function shortDescription(
  text: string | null,
  max = 200,
): string | null {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if ([...clean].length <= max) return clean;
  const cut = [...clean].slice(0, max).join("");
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max)}…`;
}
