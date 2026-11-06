import { describe, expect, it } from "vitest";

import {
  asConfirmedAction,
  asModerationError,
  asModerationNotice,
  asPersonConfirm,
  asPersonName,
  asReportId,
  maxNoteLength,
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

describe("the actions on a person with no report (SAG-146)", () => {
  const parse = (form: Record<string, unknown>) =>
    moderationActionSchema.safeParse(form);

  it("takes a username, and trims it", () => {
    const parsed = parse({ intent: "ban_person", username: "  bob_reads " });

    expect(parsed.success && parsed.data).toEqual({
      intent: "ban_person",
      username: "bob_reads",
      note: null,
    });
  });

  it("takes an internal note, trims it, and reads an empty one as none", () => {
    expect(
      parse({ intent: "suspend_person", username: "bob_reads", note: " why " })
        .data,
    ).toMatchObject({ note: "why" });
    for (const note of ["", "   "]) {
      expect(
        parse({ intent: "suspend_person", username: "bob_reads", note }).data,
      ).toMatchObject({ note: null });
    }
  });

  it("takes a note of the length that is allowed, and no longer", () => {
    expect(maxNoteLength).toBe(200);
    const ok = "x".repeat(maxNoteLength);
    expect(
      parse({ intent: "ban_person", username: "bob_reads", note: ok }).success,
    ).toBe(true);
    expect(
      parse({ intent: "ban_person", username: "bob_reads", note: ok + "x" })
        .success,
    ).toBe(false);
  });

  it("takes a warning with a reason, and needs it", () => {
    expect(
      parse({ intent: "warn_person", username: "bob_reads", reason: "spam" })
        .success,
    ).toBe(true);
    expect(
      parse({ intent: "warn_person", username: "bob_reads" }).success,
    ).toBe(false);
  });

  it("refuses a username that cannot be one, an id in its place, and any other field", () => {
    for (const form of [
      { intent: "ban_person", username: "ab" },
      { intent: "ban_person", username: "has space" },
      { intent: "ban_person", username: "a/b_c" },
      { intent: "ban_person", username: "x".repeat(31) },
      { intent: "ban_person", username: "" },
      { intent: "ban_person" },
      { intent: "ban_person", id },
      { intent: "ban_person", username: "bob_reads", id },
      { intent: "suspend_person", username: "bob_reads", reason: "spam" },
      {
        intent: "warn_person",
        username: "bob_reads",
        reason: "spam",
        role: "admin",
      },
    ]) {
      expect(parse(form).success).toBe(false);
    }
  });

  it("lets a lift say which card to come back to, and only with a username", () => {
    expect(parse({ intent: "lift", id, username: "bob_reads" }).success).toBe(
      true,
    );
    expect(parse({ intent: "lift", id }).success).toBe(true);
    expect(parse({ intent: "lift", id, username: "a b" }).success).toBe(false);
  });

  it("reads a username from the address, or nothing", () => {
    expect(asPersonName("bob_reads")).toBe("bob_reads");
    expect(asPersonName("  bob_reads ")).toBe("bob_reads");
    for (const bad of ["ab", "a b", "a/b_c", "", "  ", null, "x".repeat(31)]) {
      expect(asPersonName(bad)).toBeNull();
    }
  });

  it("confirms only suspending and banning a person, never removing a picture", () => {
    expect(asPersonConfirm("suspend")).toBe("suspend");
    expect(asPersonConfirm("ban")).toBe("ban");
    for (const other of ["remove", "lift", "warn", "", null]) {
      expect(asPersonConfirm(other)).toBeNull();
    }
  });
});
