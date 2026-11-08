import { describe, expect, it } from "vitest";

import {
  asListNotice,
  createListSchema,
  deleteListSchema,
  maxListDescription,
  maxListTitle,
  saveListSchema,
} from "./schema";

const create = (overrides: Record<string, unknown> = {}) => ({
  intent: "create",
  title: "Best sci-fi",
  description: "",
  visibility: "private",
  ...overrides,
});

describe("the form of a list (SAG-113)", () => {
  it("trims the title and the description, and makes an empty description none", () => {
    const parsed = createListSchema.parse(
      create({ title: "  Best sci-fi  ", description: "   " }),
    );

    expect(parsed).toEqual({
      intent: "create",
      title: "Best sci-fi",
      description: null,
      visibility: "private",
    });
  });

  it("counts characters like the table does: the limits are of characters, not of bytes or units", () => {
    expect(
      createListSchema.safeParse(create({ title: "🎬".repeat(maxListTitle) }))
        .success,
    ).toBe(true);
    expect(
      createListSchema.safeParse(
        create({ title: "🎬".repeat(maxListTitle + 1) }),
      ).success,
    ).toBe(false);
    expect(
      createListSchema.safeParse(
        create({ description: "é".repeat(maxListDescription) }),
      ).success,
    ).toBe(true);
    expect(
      createListSchema.safeParse(
        create({ description: "é".repeat(maxListDescription + 1) }),
      ).success,
    ).toBe(false);
  });

  it.each([
    ["an empty title", { title: "" }],
    ["a title of only spaces", { title: "   " }],
    ["a visibility that does not exist", { visibility: "everyone" }],
    ["no visibility", { visibility: undefined }],
    ["a field the form does not have", { ownerId: "someone-else" }],
  ])("refuses %s", (_name, overrides) => {
    expect(createListSchema.safeParse(create(overrides)).success).toBe(false);
    expect(
      saveListSchema.safeParse(create({ intent: "save", ...overrides }))
        .success,
    ).toBe(false);
  });

  it("keeps the intent of each form apart", () => {
    expect(saveListSchema.safeParse(create()).success).toBe(false);
    expect(createListSchema.safeParse(create({ intent: "save" })).success).toBe(
      false,
    );
    expect(deleteListSchema.safeParse({ intent: "delete" }).success).toBe(true);
    expect(
      deleteListSchema.safeParse({ intent: "delete", title: "x" }).success,
    ).toBe(false);
  });

  it("takes a notice from the address only when it is a word the page knows", () => {
    expect(asListNotice("created")).toBe("created");
    expect(asListNotice("deleted")).toBe("deleted");
    expect(asListNotice("<script>")).toBeNull();
    expect(asListNotice(null)).toBeNull();
  });
});
