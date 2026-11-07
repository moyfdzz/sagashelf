import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  asMessageError,
  asMessageId,
  asMessageNotice,
  messageActionSchema,
  runMessageAction,
} from "./messages-panel";

const mocks = vi.hoisted(() => ({
  deleteContactMessage: vi.fn(),
  setContactMessageStatus: vi.fn(),
}));

vi.mock("../db/contact-messages", () => ({
  deleteContactMessage: mocks.deleteContactMessage,
  setContactMessageStatus: mocks.setContactMessageStatus,
}));

const db = { fake: "database" } as never;
const actor = "admin-1";
const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

beforeEach(() => {
  mocks.deleteContactMessage.mockReset().mockResolvedValue(true);
  mocks.setContactMessageStatus.mockReset().mockResolvedValue(true);
});

describe("messageActionSchema (SAG-110)", () => {
  it("takes one of three actions and the id of a message, and no other field", () => {
    for (const intent of ["handled", "reopen", "delete"]) {
      expect(messageActionSchema.safeParse({ intent, id }).success).toBe(true);
    }
    expect(messageActionSchema.safeParse({ intent: "ban", id }).success).toBe(
      false,
    );
    expect(
      messageActionSchema.safeParse({ intent: "delete", id: "nope" }).success,
    ).toBe(false);
    expect(
      messageActionSchema.safeParse({ intent: "delete", id, extra: "x" })
        .success,
    ).toBe(false);
  });

  it("reads the address with words it knows only", () => {
    expect(asMessageNotice("deleted")).toBe("deleted");
    expect(asMessageNotice("<b>")).toBeNull();
    expect(asMessageNotice(null)).toBeNull();
    expect(asMessageError("not_found")).toBe("not_found");
    expect(asMessageError("failed")).toBeNull();
    expect(asMessageId(id)).toBe(id);
    expect(asMessageId("x")).toBeNull();
    expect(asMessageId(null)).toBeNull();
  });
});

describe("runMessageAction", () => {
  it("marks as handled or as new again, as the administrator of the session", async () => {
    expect(await runMessageAction(db, actor, { intent: "handled", id })).toBe(
      "notice=handled",
    );
    expect(mocks.setContactMessageStatus).toHaveBeenLastCalledWith(
      db,
      actor,
      id,
      "handled",
    );

    expect(await runMessageAction(db, actor, { intent: "reopen", id })).toBe(
      "notice=reopened",
    );
    expect(mocks.setContactMessageStatus).toHaveBeenLastCalledWith(
      db,
      actor,
      id,
      "new",
    );
  });

  it("deletes", async () => {
    expect(await runMessageAction(db, actor, { intent: "delete", id })).toBe(
      "notice=deleted",
    );
    expect(mocks.deleteContactMessage).toHaveBeenCalledWith(db, actor, id);
  });

  it("says not found when nothing changed", async () => {
    mocks.setContactMessageStatus.mockResolvedValue(false);
    mocks.deleteContactMessage.mockResolvedValue(false);

    for (const intent of ["handled", "reopen", "delete"] as const) {
      expect(await runMessageAction(db, actor, { intent, id })).toBe(
        "error=not_found",
      );
    }
  });
});
