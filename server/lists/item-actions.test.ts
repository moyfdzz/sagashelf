import { describe, expect, it } from "vitest";

import { isItemIntent, itemIntents } from "./item-actions";
import { isListItemError, listItemErrors } from "./schema";

describe("the intents of the titles of a list (SAG-163)", () => {
  it("are the forms of the titles, read from the schema", () => {
    expect([...itemIntents].sort()).toEqual([
      "move_item",
      "note_item",
      "remove_item",
    ]);
  });

  it("are told apart from the intents of the list itself", () => {
    for (const intent of itemIntents) expect(isItemIntent(intent)).toBe(true);
    for (const other of ["save", "delete", "create", "", undefined, null, 1]) {
      expect(isItemIntent(other)).toBe(false);
    }
  });
});

describe("the refusals of the titles of a list (SAG-163)", () => {
  it("are told apart from the refusals of the list, once for the whole page", () => {
    for (const error of listItemErrors) {
      expect(isListItemError(error)).toBe(true);
    }
    for (const other of [
      "invalid_request",
      "duplicate",
      "limit",
      "not_found",
      null,
      undefined,
    ]) {
      expect(isListItemError(other)).toBe(false);
    }
  });
});
