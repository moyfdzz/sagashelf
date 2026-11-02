/**
 * The message an event becomes in Discord (SAG-27, ADR-029). It is plain text and it never
 * mentions anyone: `allowed_mentions` is empty, and the text itself is made safe too, so a title
 * with `@everyone` in it (a title comes from a provider, and a note from a person) cannot ping a
 * whole server. Discord's page for this endpoint says to do both ("consider sanitizing the data ...
 * and using `allowed_mentions` to prevent unexpected mentions", read 2026-11-02).
 */

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
    default:
      return null;
  }
}
