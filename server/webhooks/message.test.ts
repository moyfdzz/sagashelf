import { describe, expect, it } from "vitest";

import { discordMessage, maxContentLength, plain } from "./message";

describe("plain (SAG-27)", () => {
  it("stops a mention from forming, whatever form it takes", () => {
    for (const text of [
      "@everyone",
      "@here",
      "<@123456789012345678>",
      "<@&987654321098765432>",
    ]) {
      const safe = plain(`hi ${text}`);

      expect(safe).not.toContain("@everyone");
      expect(safe).not.toContain("@here");
      expect(safe).not.toMatch(/@(?!\u200b)/);
    }
  });

  it("keeps the rest of the text as it was", () => {
    expect(plain("Attack on Titan (2013)")).toBe("Attack on Titan (2013)");
  });

  it("cuts the text to what Discord accepts", () => {
    expect(plain("a".repeat(maxContentLength + 500))).toHaveLength(
      maxContentLength,
    );
    expect(maxContentLength).toBe(2000);
  });
});

describe("discordMessage (SAG-27)", () => {
  it("writes the test message in the language it was queued with", () => {
    expect(discordMessage("webhook.test", { locale: "es" })?.content).toContain(
      "mensaje de prueba",
    );
    expect(discordMessage("webhook.test", { locale: "en" })?.content).toContain(
      "test message",
    );
  });

  it("falls back to Spanish for any other language, or none", () => {
    for (const payload of [{ locale: "fr" }, {}, { locale: 3 }]) {
      expect(discordMessage("webhook.test", payload)?.content).toContain(
        "mensaje de prueba",
      );
    }
  });

  it("mentions nobody: the list of mentions Discord may parse is empty", () => {
    expect(discordMessage("webhook.test", {})).toEqual({
      content: expect.any(String),
      allowed_mentions: { parse: [] },
    });
  });

  it("has no message for a type it does not know, so the event is given up on, not sent", () => {
    expect(discordMessage("nothing.here", {})).toBeNull();
    expect(discordMessage("clerk.user_rejected", {})).toBeNull();
  });
});

describe("the alert of new episodes (SAG-28)", () => {
  const aired = (payload: Record<string, unknown>) =>
    discordMessage("episode.aired", payload);

  it("tells one episode with its season and number, in the language of the person", () => {
    const episodes = [{ title: "Severance", season: 2, number: 5 }];

    expect(aired({ locale: "es", total: 1, episodes })?.content).toBe(
      "SagaShelf: ya salió un episodio nuevo de lo que estás viendo.\n• Severance: temporada 2, episodio 5",
    );
    expect(aired({ locale: "en", total: 1, episodes })?.content).toBe(
      "SagaShelf: a new episode of something you are watching is out.\n• Severance: season 2, episode 5",
    );
  });

  it("makes ONE message of several episodes, a digest and not one per series", () => {
    const message = aired({
      locale: "es",
      total: 3,
      episodes: [
        { title: "A", season: 1, number: 1 },
        { title: "B", season: 4, number: 10 },
        { title: "C", season: 2, number: 3 },
      ],
    });

    expect(message?.content.split("\n")).toEqual([
      "SagaShelf: ya salieron 3 episodios nuevos de lo que estás viendo.",
      "• A: temporada 1, episodio 1",
      "• B: temporada 4, episodio 10",
      "• C: temporada 2, episodio 3",
    ]);
  });

  it("counts the ones it does not list", () => {
    const episodes = [{ title: "A", season: 1, number: 1 }];

    expect(aired({ locale: "es", total: 5, episodes })?.content).toContain(
      "… y 4 más.",
    );
    expect(aired({ locale: "en", total: 5, episodes })?.content).toContain(
      "… and 4 more.",
    );
    expect(aired({ locale: "es", total: 1, episodes })?.content).not.toContain(
      "más",
    );
  });

  it("says only what it knows when the season or the number is missing", () => {
    const message = aired({
      locale: "es",
      total: 3,
      episodes: [
        { title: "Only a number", season: null, number: 7 },
        { title: "Nothing", season: null, number: null },
        { title: "Only a season", season: 3, number: null },
      ],
    });

    expect(message?.content).toContain("• Only a number: episodio 7");
    expect(message?.content).toContain("\n• Nothing\n");
    expect(message?.content).toMatch(/• Only a season$/);
  });

  it("mentions nobody, even when a title tries to", () => {
    const message = aired({
      locale: "en",
      total: 1,
      episodes: [
        { title: "@everyone <@123456789012345678>", season: 1, number: 1 },
      ],
    });

    expect(message?.allowed_mentions).toEqual({ parse: [] });
    expect(message?.content).not.toContain("@everyone");
    expect(message?.content).not.toMatch(/@(?!\u200b)/);
  });

  it("fits what Discord accepts, even with the longest titles", () => {
    const episodes = Array.from({ length: 10 }, (_, index) => ({
      title: `${index} ${"T".repeat(400)}`,
      season: 1,
      number: 1,
    }));

    expect(
      aired({ locale: "es", total: 10, episodes })?.content.length,
    ).toBeLessThanOrEqual(maxContentLength);
  });

  it("ignores an entry that is not an episode, and keeps the ones that are", () => {
    const message = aired({
      locale: "es",
      total: 2,
      episodes: [
        null,
        "text",
        { title: "", season: 1, number: 1 },
        { title: 42 },
        { title: "Real", season: -1, number: 1.5 },
        { title: "Kept", season: 2, number: 2 },
      ],
    });

    expect(message?.content).toContain("• Real\n");
    expect(message?.content).toContain("• Kept: temporada 2, episodio 2");
    expect(message?.content.match(/•/g)).toHaveLength(2);
  });

  it("never claims fewer episodes than it lists", () => {
    const message = aired({
      locale: "es",
      total: 0,
      episodes: [
        { title: "A", season: 1, number: 1 },
        { title: "B", season: 1, number: 2 },
      ],
    });

    expect(message?.content).toContain("ya salieron 2 episodios");
  });

  it.each([
    ["no episodes", {}],
    ["episodes that are not a list", { episodes: "A" }],
    ["an empty list", { episodes: [] }],
    ["a list with nothing to say", { episodes: [{ title: " " }, 1, null] }],
  ])("has no message for %s, so the event is given up on", (_name, payload) => {
    expect(aired({ locale: "es", total: 1, ...payload })).toBeNull();
  });
});
