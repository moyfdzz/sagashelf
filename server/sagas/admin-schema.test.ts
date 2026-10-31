import { describe, expect, it } from "vitest";

import {
  adminErrors,
  asAdminError,
  createSagaSchema,
  sagaActionSchema,
} from "./admin-schema";

describe("createSagaSchema", () => {
  it("takes the two names, trimmed", () => {
    expect(
      createSagaSchema.parse({
        intent: "create",
        titleEs: "  Ataque a los Titanes ",
        titleEn: "Attack on Titan",
      }),
    ).toEqual({
      intent: "create",
      titleEs: "Ataque a los Titanes",
      titleEn: "Attack on Titan",
    });
  });

  it("refuses an empty name, a name that is too long and a field it does not know", () => {
    const ok = { intent: "create", titleEs: "a", titleEn: "b" };

    expect(createSagaSchema.safeParse({ ...ok, titleEs: "   " }).success).toBe(
      false,
    );
    expect(
      createSagaSchema.safeParse({ ...ok, titleEn: "x".repeat(81) }).success,
    ).toBe(false);
    expect(createSagaSchema.safeParse({ ...ok, role: "admin" }).success).toBe(
      false,
    );
    expect(
      createSagaSchema.safeParse({ ...ok, intent: "publish" }).success,
    ).toBe(false);
  });
});

describe("sagaActionSchema", () => {
  it("knows the six changes of a saga", () => {
    expect(sagaActionSchema.parse({ intent: "publish" })).toEqual({
      intent: "publish",
    });
    expect(sagaActionSchema.parse({ intent: "unpublish" })).toEqual({
      intent: "unpublish",
    });
    expect(
      sagaActionSchema.parse({ intent: "rename", titleEs: "A", titleEn: "B" }),
    ).toMatchObject({ intent: "rename" });
    expect(sagaActionSchema.parse({ intent: "add", qid: "Q42" })).toEqual({
      intent: "add",
      qid: "Q42",
    });
    expect(sagaActionSchema.parse({ intent: "remove", qid: "Q42" })).toEqual({
      intent: "remove",
      qid: "Q42",
    });
    expect(
      sagaActionSchema.parse({ intent: "move", qid: "Q42", direction: "up" }),
    ).toEqual({ intent: "move", qid: "Q42", direction: "up" });
  });

  it("reads an item as a person pastes it: lowercase, with spaces, or as an address", () => {
    for (const pasted of [
      "q22126305",
      "  Q22126305 ",
      "https://www.wikidata.org/wiki/Q22126305",
      "https://www.wikidata.org/entity/q22126305",
    ]) {
      expect(sagaActionSchema.parse({ intent: "add", qid: pasted })).toEqual({
        intent: "add",
        qid: "Q22126305",
      });
    }
  });

  it("refuses what is not an item", () => {
    for (const qid of [
      "",
      "P42",
      "Q",
      "Q1 } DROP",
      "42",
      "Q1234567890123",
      "https://example.test/not-an-item",
      "x".repeat(201),
    ]) {
      expect(
        sagaActionSchema.safeParse({ intent: "add", qid }).success,
        qid,
      ).toBe(false);
    }
  });

  it("refuses an unknown change, a direction that is not up or down and a field it does not know", () => {
    expect(sagaActionSchema.safeParse({ intent: "delete" }).success).toBe(
      false,
    );
    expect(sagaActionSchema.safeParse({}).success).toBe(false);
    expect(
      sagaActionSchema.safeParse({
        intent: "move",
        qid: "Q1",
        direction: "left",
      }).success,
    ).toBe(false);
    expect(
      sagaActionSchema.safeParse({ intent: "move", qid: "Q1" }).success,
    ).toBe(false);
    expect(
      sagaActionSchema.safeParse({ intent: "publish", status: "published" })
        .success,
    ).toBe(false);
  });
});

describe("asAdminError", () => {
  it("accepts the reasons the page can say and ignores anything else", () => {
    for (const error of adminErrors) expect(asAdminError(error)).toBe(error);
    expect(asAdminError("<script>")).toBeNull();
    expect(asAdminError("")).toBeNull();
    expect(asAdminError(null)).toBeNull();
  });
});
