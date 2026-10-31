import { type Genre, uniqueGenres } from "../genres";
import type { Locale, MediaStatus, NormalizedMedia } from "../types";

type LangMap = Record<string, string>;

/** One related record of a manga, with the fields we ask for through `includes[]`. */
export type MangadexRelationship = {
  id: string;
  type: string;
  attributes?: { name?: string; fileName?: string };
};

/** A manga as MangaDex sends it, reduced to the fields that are read. */
export type MangadexManga = {
  id: string;
  type?: string;
  attributes?: {
    title?: LangMap;
    altTitles?: LangMap[];
    description?: LangMap;
    originalLanguage?: string;
    status?: string;
    year?: number | null;
    contentRating?: string;
    tags?: MangadexTag[];
    /** Ids in other catalogs: `al` is AniList, `mal` is MyAnimeList (read 2026-10-30). */
    links?: { al?: string; mal?: string } | null;
  };
  relationships?: MangadexRelationship[];
};

/** A tag as MangaDex sends it with a manga: `group` is genre, theme, format or content. */
export type MangadexTag = {
  attributes?: { name?: LangMap; group?: string };
};

/**
 * The tags of MangaDex (read 2026-10-30 from `GET /manga/tag`) that match a genre of ours, by their
 * English name. The tags of the groups `format` and `content` are never read, and a tag with no
 * match is dropped, so none of MangaDex's own tags is stored.
 */
const genreOfTag: Record<string, readonly Genre[]> = {
  action: ["action"],
  adventure: ["adventure"],
  "boys' love": ["boys_love"],
  comedy: ["comedy"],
  cooking: ["cooking"],
  crime: ["crime"],
  demons: ["supernatural"],
  drama: ["drama"],
  fantasy: ["fantasy"],
  ghosts: ["supernatural"],
  "girls' love": ["girls_love"],
  harem: ["harem"],
  historical: ["historical"],
  horror: ["horror"],
  isekai: ["isekai"],
  mafia: ["crime"],
  "magical girls": ["magical_girl"],
  "martial arts": ["martial_arts"],
  mecha: ["mecha"],
  medical: ["medical"],
  military: ["military"],
  music: ["music"],
  mystery: ["mystery"],
  philosophical: ["philosophical"],
  police: ["crime"],
  "post-apocalyptic": ["post_apocalyptic"],
  psychological: ["psychological"],
  reincarnation: ["reincarnation"],
  romance: ["romance"],
  samurai: ["samurai"],
  "school life": ["school_life"],
  "sci-fi": ["sci_fi"],
  "slice of life": ["slice_of_life"],
  sports: ["sports"],
  superhero: ["superhero"],
  supernatural: ["supernatural"],
  survival: ["survival"],
  thriller: ["thriller"],
  "time travel": ["time_travel"],
  tragedy: ["tragedy"],
  vampires: ["vampire"],
  "video games": ["video_games"],
  wuxia: ["wuxia"],
  zombies: ["zombie"],
};

const readGroups = new Set(["genre", "theme"]);

const numericId = /^[0-9]{1,9}$/;

/** The AniList and MyAnimeList ids of a manga, which are the bridge to Wikidata (SAG-16). */
export function crossIdsOfLinks(
  links: NonNullable<MangadexManga["attributes"]>["links"],
): { mal?: string; anilist?: string } {
  const mal = links?.mal?.trim();
  const anilist = links?.al?.trim();
  return {
    ...(mal && numericId.test(mal) ? { mal } : {}),
    ...(anilist && numericId.test(anilist) ? { anilist } : {}),
  };
}

/** The genres of our list for the tags of a manga. */
export function genresOfTags(tags: readonly MangadexTag[]): Genre[] {
  return uniqueGenres(
    tags.flatMap((tag) => {
      const group = tag.attributes?.group;
      const name = tag.attributes?.name?.en?.trim().toLowerCase();
      return group && readGroups.has(group) && name
        ? (genreOfTag[name] ?? [])
        : [];
    }),
  );
}

export const coverBase = "https://uploads.mangadex.org/covers";

/**
 * The ratings we show. Adult material (`erotica`, `pornographic`) is left out of the request and
 * out of the mapping too, so a title opened by its id does not get around it (SAG-70 will let a
 * person choose).
 */
export const allowedRatings = ["safe", "suggestive"] as const;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The id of a manga in lowercase, or null when it is not one. */
export function parseExternalId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return uuid.test(id) ? id : null;
}

const textOrNull = (value: string | null | undefined) =>
  value && value.trim() !== "" ? value.trim() : null;

/** The language codes MangaDex uses for the two languages of the app. */
const languages: Record<Locale, readonly string[]> = {
  es: ["es", "es-la"],
  en: ["en"],
};

/**
 * The title in the language of the visitor when the title or one of the alternative titles has it,
 * then in English, then the title MangaDex lists (mostly the romaji), then any alternative.
 */
function chooseTitle(
  attributes: NonNullable<MangadexManga["attributes"]>,
  locale: Locale,
): string | null {
  const main = attributes.title ?? {};
  const alts = attributes.altTitles ?? [];
  const inLanguage = (codes: readonly string[]) => {
    for (const code of codes) {
      const fromMain = textOrNull(main[code]);
      if (fromMain) return fromMain;
      for (const alt of alts) {
        const found = textOrNull(alt[code]);
        if (found) return found;
      }
    }
    return null;
  };
  return (
    inLanguage(languages[locale]) ??
    inLanguage(languages.en) ??
    textOrNull(Object.values(main)[0]) ??
    textOrNull(alts.flatMap((alt) => Object.values(alt))[0])
  );
}

/**
 * A description as plain text. MangaDex writes Markdown and often adds a line of rule (`---` or
 * `___`) followed by credits and links, which we do not show.
 */
export function plainDescription(raw: string | undefined): string | null {
  if (!raw) return null;
  const first =
    raw.split(/(?:^|\n)\s*(?:-{3,}|_{3,}|\*{3,})\s*(?:\n|$)/)[0] ?? "";
  return textOrNull(
    first
      .replace(/\r\n?/g, "\n")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

function statusOf(status: string | undefined): MediaStatus {
  switch (status) {
    case "ongoing":
      return "ongoing";
    case "completed":
      return "finished";
    case "cancelled":
      return "cancelled";
    // A series on hiatus is neither being published nor over.
    default:
      return "unknown";
  }
}

/**
 * One manga as a title of ours, or null when it is not a manga we may show. The text of a
 * description is in the languages MangaDex has it in, so both of ours are filled at once and a
 * second call for the other language is not needed.
 */
export function mapManga(
  raw: MangadexManga,
  locale: Locale,
): NormalizedMedia | null {
  const id = parseExternalId(raw.id ?? "");
  const attributes = raw.attributes;
  if (!id || !attributes) return null;
  if (
    !allowedRatings.includes(
      (attributes.contentRating ?? "safe") as (typeof allowedRatings)[number],
    )
  ) {
    return null;
  }
  const title = chooseTitle(attributes, locale);
  if (!title) return null;

  const original =
    textOrNull(Object.values(attributes.title ?? {})[0]) ??
    textOrNull(
      (attributes.altTitles ?? []).find(
        (alt) =>
          attributes.originalLanguage && alt[attributes.originalLanguage],
      )?.[attributes.originalLanguage ?? ""],
    );

  const description = attributes.description ?? {};
  const es = plainDescription(description.es ?? description["es-la"]);
  const en = plainDescription(description.en);

  const creators = [
    ...new Set(
      (raw.relationships ?? [])
        .filter((rel) => rel.type === "author" || rel.type === "artist")
        .map((rel) => textOrNull(rel.attributes?.name))
        .filter((name): name is string => name !== null),
    ),
  ];
  const cover = textOrNull(
    raw.relationships?.find((rel) => rel.type === "cover_art")?.attributes
      ?.fileName,
  );

  return {
    type: "manga",
    title,
    originalTitle: original && original !== title ? original : null,
    year: attributes.year ?? null,
    synopsis: { ...(es ? { es } : {}), ...(en ? { en } : {}) },
    ...(creators.length > 0 ? { creators } : {}),
    // MangaDex always sends the tags of a manga: a manga with none of ours is "asked, none".
    genres: genresOfTags(attributes.tags ?? []),
    crossIds: crossIdsOfLinks(attributes.links),
    imageUrl: cover ? `${coverBase}/${id}/${cover}` : null,
    status: statusOf(attributes.status),
    // MangaDex sends no popularity with a search; the order is its relevance, which is kept.
    popularity: 0,
    externalId: { provider: "mangadex", id },
  };
}
