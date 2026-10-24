import { describe, expect, it } from "vitest";

import { usernameAvailableAt, usernameChangeSchema } from "./username-schema";

const check = (username: string) => {
  const result = usernameChangeSchema.safeParse({ username });
  return result.success ? "ok" : result.error.issues[0]?.message;
};

describe("usernameChangeSchema", () => {
  it.each(["ana_reads", "Ana", "a1b", "x".repeat(30), "2fast"])(
    "accepts %s",
    (name) => expect(check(name)).toBe("ok"),
  );

  it("trims the name", () => {
    expect(
      usernameChangeSchema.parse({ username: "  ana_reads " }).username,
    ).toBe("ana_reads");
  });

  it("keeps the rules of the base schema", () => {
    expect(check("ab")).toBe("username_too_short");
    expect(check("x".repeat(31))).toBe("username_too_long");
    expect(check("has space")).toBe("username_has_spaces");
    expect(check("admin")).toBe("username_reserved");
  });

  it.each(["12345", "ana-reads", "ana.reads", "añadir", "ana😀", "<ana>"])(
    "refuses %s",
    (name) => expect(check(name)).toBe("username_invalid"),
  );

  it("refuses any other field, such as another account's id", () => {
    expect(
      usernameChangeSchema.safeParse({ username: "ana_reads", clerkId: "x" })
        .success,
    ).toBe(false);
  });
});

describe("usernameAvailableAt", () => {
  const now = new Date("2026-11-01T00:00:00Z");

  it("is null for someone who never changed it", () => {
    expect(usernameAvailableAt(null, now)).toBeNull();
  });

  it("is 30 days after the last change", () => {
    const changed = new Date("2026-10-25T00:00:00Z");

    expect(usernameAvailableAt(changed, now)?.toISOString()).toBe(
      "2026-11-24T00:00:00.000Z",
    );
  });

  it("is null once the 30 days have passed, to the second", () => {
    const changed = new Date("2026-10-02T00:00:00Z");

    expect(usernameAvailableAt(changed, now)).toBeNull();
    expect(
      usernameAvailableAt(changed, new Date("2026-11-01T00:00:00Z")),
    ).toBeNull();
    expect(
      usernameAvailableAt(changed, new Date("2026-10-31T23:59:59Z")),
    ).not.toBeNull();
  });
});
