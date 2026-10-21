import { describe, expect, it } from "vitest";

import en from "./en.json";
import es from "./es.json";
import { fallbackLanguage, resources, supportedLanguages } from "./index";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>(
    (flat, [key, value]) =>
      typeof value === "string"
        ? { ...flat, [`${prefix}${key}`]: value }
        : { ...flat, ...flatten(value, `${prefix}${key}.`) },
    {},
  );
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

const spanish = flatten(es);
const english = flatten(en);

describe("locales", () => {
  it("have exactly the same keys in every language", () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(spanish).sort());
  });

  it("have no empty messages", () => {
    for (const [lang, messages] of Object.entries({
      es: spanish,
      en: english,
    })) {
      for (const [key, message] of Object.entries(messages)) {
        expect(message.trim(), `${lang}: ${key}`).not.toBe("");
      }
    }
  });

  it("use the same {{placeholders}} in every language", () => {
    for (const key of Object.keys(spanish)) {
      expect(placeholders(english[key] ?? ""), key).toEqual(
        placeholders(spanish[key] ?? ""),
      );
    }
  });

  it("register every supported language, with Spanish as the default", () => {
    expect(Object.keys(resources).sort()).toEqual(
      [...supportedLanguages].sort(),
    );
    expect(fallbackLanguage).toBe("es");
  });
});
