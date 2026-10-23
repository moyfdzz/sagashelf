import { describe, expect, it } from "vitest";

import {
  bioMaxLength,
  cleanText,
  displayNameMaxLength,
  profileUpdateSchema,
  usernameSchema,
} from "./profile-schema";

const parse = (input: unknown) => profileUpdateSchema.safeParse(input);

describe("cleanText", () => {
  it("keeps accents, emoji and letters from other scripts", () => {
    expect(cleanText("Ana María 🌸 田中", false)).toBe("Ana María 🌸 田中");
  });

  it("turns accented letters written in two parts into one", () => {
    // "e" followed by a combining acute accent becomes the single letter "é".
    expect(cleanText("café", false)).toBe("café");
  });

  it("removes control codes", () => {
    expect(cleanText("a\u0000b\u0007c\u007fd\u0085e", false)).toBe("abcde");
  });

  it("removes characters that reverse text or hide in it", () => {
    expect(cleanText("a‮b⁦c​d‌e﻿", false)).toBe("abcde");
  });

  it("keeps line breaks and tabs only when asked, and otherwise makes them spaces", () => {
    expect(cleanText("a\nb\tc", true)).toBe("a\nb\tc");
    expect(cleanText("a\nb\tc", false)).toBe("a b c");
  });
});

describe("profileUpdateSchema: display name", () => {
  const name = (value: unknown) => {
    const result = parse({ displayName: value });
    return result.success ? result.data.displayName : "invalid";
  };

  it("trims, collapses spaces and keeps one line", () => {
    expect(name("  Ana   María \n López ")).toBe("Ana María López");
  });

  it("turns an empty name into none", () => {
    expect(name("")).toBeNull();
    expect(name("   ​ ")).toBeNull();
  });

  it("allows the limit and refuses one more, counting characters and not bytes", () => {
    expect(name("á".repeat(displayNameMaxLength))).toBe(
      "á".repeat(displayNameMaxLength),
    );
    expect(name("🌸".repeat(displayNameMaxLength))).toBe(
      "🌸".repeat(displayNameMaxLength),
    );
    expect(name("a".repeat(displayNameMaxLength + 1))).toBe("invalid");
  });

  it("refuses something that is not text", () => {
    expect(name(42)).toBe("invalid");
    expect(name(null)).toBe("invalid");
    expect(name({})).toBe("invalid");
  });
});

describe("profileUpdateSchema: bio", () => {
  const bio = (value: unknown) => {
    const result = parse({ bio: value });
    return result.success ? result.data.bio : "invalid";
  };

  it("keeps line breaks, limits blank lines to one and trims", () => {
    expect(bio("  Hola\r\n\r\n\r\n\r\nMundo  \nfin ")).toBe(
      "Hola\n\nMundo\nfin",
    );
  });

  it("stores markup as plain text, to be escaped when drawn", () => {
    expect(bio("<b>hi</b> <script>alert(1)</script>")).toBe(
      "<b>hi</b> <script>alert(1)</script>",
    );
  });

  it("allows the limit of the database and refuses one more", () => {
    expect(bio("x".repeat(bioMaxLength))).toBe("x".repeat(bioMaxLength));
    expect(bio("🌸".repeat(bioMaxLength))).toBe("🌸".repeat(bioMaxLength));
    expect(bio("x".repeat(bioMaxLength + 1))).toBe("invalid");
  });

  it("counts the limit after cleaning, not before", () => {
    const padded = `${"​".repeat(100)}${"x".repeat(bioMaxLength)}`;
    expect(bio(padded)).toBe("x".repeat(bioMaxLength));
  });

  it("turns an empty bio into none", () => {
    expect(bio("")).toBeNull();
    expect(bio("\n\n  \n")).toBeNull();
  });
});

describe("profileUpdateSchema: language, privacy and the shape", () => {
  it("accepts only the two languages and the three privacy levels", () => {
    expect(parse({ locale: "en", privacy: "friends" }).success).toBe(true);
    expect(parse({ locale: "fr" }).success).toBe(false);
    expect(parse({ privacy: "everyone" }).success).toBe(false);
    expect(parse({ locale: "ES" }).success).toBe(false);
  });

  it("accepts a form that sends only some fields, and an empty one", () => {
    expect(parse({ bio: "hi" })).toMatchObject({
      success: true,
      data: { bio: "hi" },
    });
    expect(parse({})).toMatchObject({ success: true, data: {} });
  });

  it("refuses any field the form is not allowed to change", () => {
    for (const field of [
      "role",
      "clerkId",
      "id",
      "deletedAt",
      "emailCanonical",
      "username",
      "email",
    ]) {
      expect(parse({ displayName: "Ana", [field]: "x" }).success).toBe(false);
    }
  });

  it("does not let a prototype key through", () => {
    expect(parse(JSON.parse('{"__proto__": {"role": "admin"}}')).success).toBe(
      false,
    );
  });

  it("refuses something that is not an object", () => {
    for (const value of [null, "text", 7, [], undefined]) {
      expect(parse(value).success).toBe(false);
    }
  });
});

describe("usernameSchema", () => {
  const check = (value: unknown) => {
    const result = usernameSchema.safeParse(value);
    return result.success ? result.data : result.error.issues[0]?.message;
  };

  it("accepts a normal name and trims it", () => {
    expect(check("  ana_reads ")).toBe("ana_reads");
  });

  it("refuses short, long and spaced names", () => {
    expect(check("ab")).toBe("username_too_short");
    expect(check("x".repeat(31))).toBe("username_too_long");
    expect(check("has space")).toBe("username_has_spaces");
  });

  it("refuses reserved names in any letter case", () => {
    for (const name of ["admin", "Admin", "API", "Settings", "sign-in"]) {
      expect(check(name)).toBe("username_reserved");
    }
  });

  it("allows a name that only contains a reserved word", () => {
    expect(check("admin_fan")).toBe("admin_fan");
  });
});
