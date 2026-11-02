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
