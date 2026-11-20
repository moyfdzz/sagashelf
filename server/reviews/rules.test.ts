import { describe, expect, it } from "vitest";

import {
  bodyProblem,
  duplicateKey,
  hasLink,
  normalizeReviewBody,
  reviewFingerprint,
  reviewLength,
  reviewMaxLength,
  reviewMinLength,
  splitExcerpt,
} from "./rules";

// SAG-22, ADR-053: the rules of a review that need no database.

const of = (length: number) => "a".repeat(length);

describe("the length of a review", () => {
  it("allows 500 to 5000 characters, counted as Postgres counts them", () => {
    expect(bodyProblem(of(reviewMinLength - 1))).toBe("too_short");
    expect(bodyProblem(of(reviewMinLength))).toBeNull();
    expect(bodyProblem(of(reviewMaxLength))).toBeNull();
    expect(bodyProblem(of(reviewMaxLength + 1))).toBe("too_long");
    // An emoji is two UTF-16 units and one character.
    expect(reviewLength("🎬".repeat(500))).toBe(500);
    expect(bodyProblem("🎬".repeat(500))).toBeNull();
  });

  it("keeps the paragraphs and drops the spaces at the ends", () => {
    expect(normalizeReviewBody("  one\r\ntwo\rthree\n\nfour  ")).toBe(
      "one\ntwo\nthree\n\nfour",
    );
  });
});

describe("links in a review", () => {
  it.each([
    "see https://example.test/x",
    "go to HTTP://spam.test",
    "visit www.spam-site.info",
    "buy at cheap-pills.com today",
    "my blog sub.domain.net",
    "write to me@mail.ru",
    "ftp://files.test/a",
    "BUY AT SPAM.COM",
  ])("refuses %j", (text) => {
    expect(hasLink(text)).toBe(true);
  });

  it.each([
    "Dr. Stone is great. The end.",
    "Episode 3.5 was a recap",
    "It costs 9.99 and is worth it",
    "Mr.Robot season one",
    "una reseña normal, sin enlaces... ni nada",
    // A sentence that starts right after a period, with no space.
    "me gustó mucho.Es una serie muy buena",
    "lo mejor.es que no se alarga",
    "dijo.Me gustó el final",
    "the end.Live action is next",
  ])("lets %j through", (text) => {
    expect(hasLink(text)).toBe(false);
  });

  it("says why the text is refused", () => {
    expect(bodyProblem(`${of(600)} www.spam.test`)).toBe("link");
  });
});

describe("duplicate texts", () => {
  it("compares without case, accents, spaces or punctuation", async () => {
    expect(duplicateKey("¡Qué  GRAN serie!!\n\nMuy buena.")).toBe(
      "que gran serie muy buena",
    );
    expect(await reviewFingerprint("Gran serie, muy buena")).toBe(
      await reviewFingerprint("gran SERIE — muy buena!!!"),
    );
    expect(await reviewFingerprint("Gran serie")).not.toBe(
      await reviewFingerprint("Gran película"),
    );
  });

  it("is a SHA-256 in hex, as the check of the column asks", async () => {
    expect(await reviewFingerprint("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the excerpt", () => {
  it("keeps a short text whole", () => {
    expect(splitExcerpt("short", 10)).toEqual({ excerpt: "short", rest: "" });
  });

  it("cuts at a space, and the two parts are the whole text", () => {
    const body = "one two three four five six";
    const { excerpt, rest } = splitExcerpt(body, 12);
    expect(excerpt).toBe("one two");
    expect(excerpt + rest).toBe(body);
  });

  it("cuts a long word where it must when there is no space near", () => {
    const body = `${"x".repeat(30)} end`;
    const { excerpt, rest } = splitExcerpt(body, 10);
    expect(excerpt).toBe("x".repeat(10));
    expect(excerpt + rest).toBe(body);
  });
});
