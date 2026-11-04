/**
 * The message an event becomes in Discord (SAG-27, ADR-029). It is plain text and it never
 * mentions anyone: `allowed_mentions` is empty, and the text itself is made safe too, so a title
 * with `@everyone` in it (a title comes from a provider, and a note from a person) cannot ping a
 * whole server. Discord's page for this endpoint says to do both ("consider sanitizing the data ...
 * and using `allowed_mentions` to prevent unexpected mentions", read 2026-11-02).
 */

import { episodeAiredEvent } from "./events";

/** What Discord accepts in `content` ("up to 2000 characters", the same page and date). */
export const maxContentLength = 2000;

export type DiscordMessage = {
  content: string;
  allowed_mentions: { parse: never[] };
};

/** Text that came from outside, made safe to put in a message: no mention can form, and it fits. */
export function plain(text: string): string {
  // A zero-width space after the @ stops `@everyone`, `@here` and `<@id>` from being read as mentions.
  return text.replaceAll("@", "@\u200b").slice(0, maxContentLength);
}

const testText = {
  es: "SagaShelf: este es un mensaje de prueba. Tu webhook funciona.",
  en: "SagaShelf: this is a test message. Your webhook works.",
} as const;

const message = (content: string): DiscordMessage => ({
  content: plain(content),
  allowed_mentions: { parse: [] },
});

type EpisodeLine = {
  title: string;
  season: number | null;
  number: number | null;
};

const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

/**
 * What `episode.aired` carries (SAG-28, ADR-030): the episodes that came out for one person's
 * endpoint, the first few of them, and how many there were. The payload comes from the database, so
 * it is checked here and not trusted; a payload that says nothing yields null and the event is
 * given up on.
 */
function episodesOf(
  payload: Record<string, unknown>,
): { lines: EpisodeLine[]; total: number } | null {
  if (!Array.isArray(payload.episodes)) return null;
  const lines: EpisodeLine[] = [];
  for (const entry of payload.episodes) {
    if (!entry || typeof entry !== "object") continue;
    const { title, season, number } = entry as Record<string, unknown>;
    if (typeof title !== "string" || title.trim() === "") continue;
    lines.push({ title, season: asCount(season), number: asCount(number) });
  }
  if (lines.length === 0) return null;
  const total = asCount(payload.total);
  return {
    lines,
    total: total !== null && total >= lines.length ? total : lines.length,
  };
}

const episodeText = {
  es: {
    one: "SagaShelf: ya salió un episodio nuevo de lo que estás viendo.",
    other: (total: number) =>
      `SagaShelf: ya salieron ${total} episodios nuevos de lo que estás viendo.`,
    season: (season: number, number: number) =>
      `temporada ${season}, episodio ${number}`,
    episode: (number: number) => `episodio ${number}`,
    more: (rest: number) => `… y ${rest} más.`,
  },
  en: {
    one: "SagaShelf: a new episode of something you are watching is out.",
    other: (total: number) =>
      `SagaShelf: ${total} new episodes of what you are watching are out.`,
    season: (season: number, number: number) =>
      `season ${season}, episode ${number}`,
    episode: (number: number) => `episode ${number}`,
    more: (rest: number) => `… and ${rest} more.`,
  },
} as const;

/**
 * Which episode a line is about, in words ("temporada 2, episodio 5"), or null when the provider gave
 * no number. The Discord message and the notification inside the app (SAG-102) both use it, so they
 * say the same thing.
 */
export function episodeLabel(
  locale: "es" | "en",
  line: { season: number | null; number: number | null },
): string | null {
  const text = episodeText[locale];
  if (line.season !== null && line.number !== null) {
    return text.season(line.season, line.number);
  }
  return line.number !== null ? text.episode(line.number) : null;
}

/**
 * What the notification inside the app shows for an `episode.aired` row: the title and which
 * episode. The payload comes from the database, so it is checked and not trusted; null means it says
 * nothing and the row is not shown.
 */
export function episodeNotice(
  payload: Record<string, unknown>,
  locale: "es" | "en",
): { title: string; which: string | null; mediaId: string | null } | null {
  const { title, season, number, mediaId } = payload;
  if (typeof title !== "string" || title.trim() === "") return null;
  return {
    title,
    which: episodeLabel(locale, {
      season: asCount(season),
      number: asCount(number),
    }),
    mediaId: typeof mediaId === "string" ? mediaId : null,
  };
}

/** One message for all the episodes of the moment: a digest, not one message per series. */
function episodesMessage(
  payload: Record<string, unknown>,
  locale: "es" | "en",
): DiscordMessage | null {
  const episodes = episodesOf(payload);
  if (!episodes) return null;
  const text = episodeText[locale];
  const lines = episodes.lines.map((line) => {
    const which = episodeLabel(locale, line);
    return which ? `• ${line.title}: ${which}` : `• ${line.title}`;
  });
  const rest = episodes.total - episodes.lines.length;
  return message(
    [
      episodes.total === 1 ? text.one : text.other(episodes.total),
      ...lines,
      ...(rest > 0 ? [text.more(rest)] : []),
    ].join("\n"),
  );
}

/**
 * The message of an event, in the language the event was queued with, or null for a type that
 * has none (it is then given up on, not sent).
 */
export function discordMessage(
  type: string,
  payload: Record<string, unknown>,
): DiscordMessage | null {
  const locale = payload.locale === "en" ? "en" : "es";
  switch (type) {
    case "webhook.test":
      return message(testText[locale]);
    case episodeAiredEvent:
      return episodesMessage(payload, locale);
    default:
      return null;
  }
}
