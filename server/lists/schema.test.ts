import { describe, expect, it } from "vitest";

import {
  asListNotice,
  createListSchema,
  addToListSchema,
  deleteListSchema,
  maxItemNote,
  maxListDescription,
  maxListItems,
  maxListTitle,
  moveItemSchema,
  noteItemSchema,
  removeItemSchema,
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

  it("saves the new lines of a description as one character, like the note of a title (SAG-163)", () => {
    // 500 characters once each `\r\n` counts as one, but more than 500 as the browser sends them.
    const typed = `${"a".repeat(maxListDescription - 4)}\r\nb\r\nc`;
    expect(typed.length).toBeGreaterThan(maxListDescription);

    const parsed = createListSchema.safeParse(create({ description: typed }));

    expect(parsed.data?.description).toBe(
      `${"a".repeat(maxListDescription - 4)}\nb\nc`,
    );
    expect(
      createListSchema.safeParse(
        create({ description: `${"a".repeat(maxListDescription)}\r\nb` }),
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

describe("the forms of the titles of a list (SAG-113)", () => {
  const media = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaa1";

  it("allows 200 titles in a list and a note of 500 characters, as the table does", () => {
    expect(maxListItems).toBe(200);
    expect(maxItemNote).toBe(500);
  });

  it("trims a note, counts an emoji as one character, and makes an empty note none", () => {
    const parse = (note: string) =>
      noteItemSchema.parse({ intent: "note_item", mediaId: media, note });

    expect(parse("  Gift  ").note).toBe("Gift");
    expect(parse("   ").note).toBeNull();
    expect(parse("😀".repeat(maxItemNote)).note).toHaveLength(maxItemNote * 2);
    expect(
      noteItemSchema.safeParse({
        intent: "note_item",
        mediaId: media,
        note: "a".repeat(maxItemNote + 1),
      }).success,
    ).toBe(false);
  });

  it("saves a new line as one character, so a note the browser allowed is not refused", () => {
    const parse = (note: string) =>
      noteItemSchema.safeParse({ intent: "note_item", mediaId: media, note });

    // A textarea of 500 characters with new lines is sent with `\r\n`: 2 each.
    const typed = `${"a".repeat(maxItemNote - 4)}\r\nb\r\nc`;
    expect(typed.length).toBeGreaterThan(maxItemNote);
    const parsed = parse(typed);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.note).toBe(`${"a".repeat(maxItemNote - 4)}\nb\nc`);
    // The limit still holds once the lines are counted as one.
    expect(parse(`${"a".repeat(maxItemNote)}\r\nb`).success).toBe(false);
  });

  it("saves a lone carriage return as a new line too", () => {
    const parsed = noteItemSchema.parse({
      intent: "note_item",
      mediaId: media,
      note: "a\rb\r\nc",
    });

    expect(parsed.note).toBe("a\nb\nc");
  });

  it("takes a move only up or down, and only with the fields of the form", () => {
    const move = (extra: Record<string, unknown>) =>
      moveItemSchema.safeParse({
        intent: "move_item",
        mediaId: media,
        ...extra,
      });

    expect(move({ direction: "up" }).success).toBe(true);
    expect(move({ direction: "down" }).success).toBe(true);
    expect(move({ direction: "sideways" }).success).toBe(false);
    expect(move({ direction: "up", ownerId: "x" }).success).toBe(false);
  });

  it("takes a title that is an id, and nothing else, to remove it", () => {
    expect(
      removeItemSchema.safeParse({ intent: "remove_item", mediaId: media })
        .success,
    ).toBe(true);
    expect(
      removeItemSchema.safeParse({ intent: "remove_item", mediaId: "x" })
        .success,
    ).toBe(false);
    expect(
      removeItemSchema.safeParse({
        intent: "remove_item",
        mediaId: media,
        x: 1,
      }).success,
    ).toBe(false);
  });

  it("takes a list and a title, both ids, for the button to add", () => {
    expect(
      addToListSchema.safeParse({ listId: media, mediaId: media }).success,
    ).toBe(true);
    expect(
      addToListSchema.safeParse({ listId: "x", mediaId: media }).success,
    ).toBe(false);
    expect(addToListSchema.safeParse({ listId: media }).success).toBe(false);
  });

  it("knows the notices of the titles and ignores any other word", () => {
    expect(asListNotice("removed")).toBe("removed");
    expect(asListNotice("moved")).toBe("moved");
    expect(asListNotice("note_saved")).toBe("note_saved");
    expect(asListNotice("something")).toBeNull();
  });
});
