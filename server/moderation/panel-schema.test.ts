import { describe, expect, it } from "vitest";

import {
  asConfirmedAction,
  asModerationError,
  asModerationNotice,
  asReportId,
  moderationActionSchema,
} from "./panel-schema";

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

describe("moderationActionSchema", () => {
  it.each(["dismiss", "restore", "remove", "suspend", "ban", "lift"])(
    "takes %s with an id",
    (intent) => {
      expect(moderationActionSchema.safeParse({ intent, id }).success).toBe(
        true,
      );
    },
  );

  it("takes a warning with an id and a reason", () => {
    expect(
      moderationActionSchema.safeParse({ intent: "warn", id, reason: "spam" })
        .success,
    ).toBe(true);
  });

  it("refuses an action it does not know, an id that is not one, and a missing field", () => {
    for (const form of [
      { intent: "delete", id },
      { intent: "ban", id: "nope" },
      { intent: "ban" },
      { id },
      { intent: "warn", id },
      { intent: "warn", id, reason: "x".repeat(41) },
    ]) {
      expect(moderationActionSchema.safeParse(form).success).toBe(false);
    }
  });

  it("refuses any field the action does not have", () => {
    for (const form of [
      { intent: "ban", id, reason: "spam" },
      { intent: "dismiss", id, status: "resolved" },
      { intent: "warn", id, reason: "spam", role: "admin" },
      { intent: "lift", id, userId: id },
    ]) {
      expect(moderationActionSchema.safeParse(form).success).toBe(false);
    }
  });
});

describe("what the address may carry", () => {
  it("knows the actions that ask to be confirmed, and only those", () => {
    for (const action of ["remove", "suspend", "ban"]) {
      expect(asConfirmedAction(action)).toBe(action);
    }
    for (const other of ["dismiss", "restore", "lift", "warn", "", null]) {
      expect(asConfirmedAction(other)).toBeNull();
    }
  });

  it("knows the words of the notices and the errors, and nothing else", () => {
    for (const word of ["warned", "suspended", "banned", "lifted"]) {
      expect(asModerationNotice(word)).toBe(word);
    }
    for (const word of ["not_allowed", "picture_hidden", "failed"]) {
      expect(asModerationError(word)).toBe(word);
    }
    expect(asModerationNotice("<b>")).toBeNull();
    expect(asModerationError("warned")).toBeNull();
    expect(asModerationNotice(null)).toBeNull();
  });

  it("takes a report id only if it is one", () => {
    expect(asReportId(id)).toBe(id);
    expect(asReportId("nope")).toBeNull();
    expect(asReportId(null)).toBeNull();
  });
});
