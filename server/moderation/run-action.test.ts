import { beforeEach, describe, expect, it, vi } from "vitest";

import { runModerationAction, type ClerkUsers } from "./run-action";

const mocks = vi.hoisted(() => ({
  findReportedPerson: vi.fn(),
  findRestrictedAccount: vi.fn(),
  liftRestriction: vi.fn(),
  restrictAccount: vi.fn(),
  warnPerson: vi.fn(),
  dismissReport: vi.fn(),
  findPictureReport: vi.fn(),
  recordPictureRemoved: vi.fn(),
  restorePicture: vi.fn(),
  deleteUserProfileImage: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  lockUser: vi.fn(),
  unlockUser: vi.fn(),
}));

vi.mock("../db/account-actions", () => ({
  findReportedPerson: mocks.findReportedPerson,
  findRestrictedAccount: mocks.findRestrictedAccount,
  liftRestriction: mocks.liftRestriction,
  restrictAccount: mocks.restrictAccount,
  warnPerson: mocks.warnPerson,
}));
vi.mock("../db/moderation", () => ({
  dismissReport: mocks.dismissReport,
  findPictureReport: mocks.findPictureReport,
  recordPictureRemoved: mocks.recordPictureRemoved,
  restorePicture: mocks.restorePicture,
}));

const db = { execute: vi.fn() };
const clerk = {
  deleteUserProfileImage: mocks.deleteUserProfileImage,
  banUser: mocks.banUser,
  unbanUser: mocks.unbanUser,
  lockUser: mocks.lockUser,
  unlockUser: mocks.unlockUser,
} as unknown as ClerkUsers;

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const actor = "admin-1";

const person = (fields: Record<string, unknown> = {}) => ({
  reportId: id,
  userId: "user-9",
  clerkId: "clerk_9",
  kind: "user",
  reason: "spam",
  state: "active",
  protected: false,
  pictureHidden: false,
  ...fields,
});

const run = (form: Record<string, string>) =>
  runModerationAction(db, clerk, actor, form as never);

/** The order in which the mocks were called, to say that Clerk goes first. */
const order = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.dismissReport.mockResolvedValue(true);
  mocks.restorePicture.mockResolvedValue(true);
  mocks.findPictureReport.mockResolvedValue({
    id,
    clerkId: "clerk_9",
    current: true,
  });
  mocks.recordPictureRemoved.mockResolvedValue(true);
  mocks.deleteUserProfileImage.mockResolvedValue({
    imageUrl: "https://img.clerk.com/generated",
    hasImage: false,
    updatedAt: 1_793_900_000_000,
  });
  mocks.findReportedPerson.mockResolvedValue(person());
  mocks.warnPerson.mockResolvedValue(true);
  mocks.restrictAccount.mockResolvedValue(true);
  mocks.findRestrictedAccount.mockResolvedValue({
    clerkId: "clerk_9",
    state: "banned",
  });
  mocks.liftRestriction.mockResolvedValue(true);
  for (const call of [
    mocks.banUser,
    mocks.unbanUser,
    mocks.lockUser,
    mocks.unlockUser,
  ]) {
    call.mockResolvedValue({});
  }
});

describe("dismissing and restoring", () => {
  it("dismisses as the administrator, and says not found when nothing changed", async () => {
    expect(await run({ intent: "dismiss", id })).toBe("notice=dismissed");
    expect(mocks.dismissReport).toHaveBeenCalledWith(db, actor, id);

    mocks.dismissReport.mockResolvedValue(false);
    expect(await run({ intent: "dismiss", id })).toBe("error=not_found");
  });

  it("restores as the administrator, and says not found when nothing changed", async () => {
    expect(await run({ intent: "restore", id })).toBe("notice=restored");
    expect(mocks.restorePicture).toHaveBeenCalledWith(db, actor, id);

    mocks.restorePicture.mockResolvedValue(false);
    expect(await run({ intent: "restore", id })).toBe("error=not_found");
  });

  it("never calls Clerk for either", async () => {
    await run({ intent: "dismiss", id });
    await run({ intent: "restore", id });

    for (const call of Object.values(clerk)) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});

describe("removing a picture", () => {
  it("deletes it in Clerk first, and then writes what Clerk answered", async () => {
    expect(await run({ intent: "remove", id })).toBe("notice=removed");

    expect(mocks.deleteUserProfileImage).toHaveBeenCalledWith("clerk_9");
    expect(mocks.recordPictureRemoved).toHaveBeenCalledWith(db, actor, id, {
      avatarUrl: "https://img.clerk.com/generated",
      hasOwnPicture: false,
      updatedAt: new Date(1_793_900_000_000),
    });
    expect(order(mocks.deleteUserProfileImage)).toBeLessThan(
      order(mocks.recordPictureRemoved),
    );
  });

  it("does not store an address that is not https", async () => {
    mocks.deleteUserProfileImage.mockResolvedValue({
      imageUrl: "http://img.clerk.com/generated",
      hasImage: false,
      updatedAt: 1,
    });

    await run({ intent: "remove", id });

    expect(mocks.recordPictureRemoved.mock.calls[0]?.[3].avatarUrl).toBeNull();
  });

  it("touches nothing in Clerk for a report that is not open, or not of a picture", async () => {
    mocks.findPictureReport.mockResolvedValue(null);

    expect(await run({ intent: "remove", id })).toBe("error=not_found");
    expect(mocks.deleteUserProfileImage).not.toHaveBeenCalled();
  });

  it("does not delete a picture the person has replaced since", async () => {
    mocks.findPictureReport.mockResolvedValue({
      id,
      clerkId: "clerk_9",
      current: false,
    });

    expect(await run({ intent: "remove", id })).toBe("error=outdated");
    expect(mocks.deleteUserProfileImage).not.toHaveBeenCalled();
  });

  it("changes nothing here when Clerk refuses", async () => {
    mocks.deleteUserProfileImage.mockRejectedValue(new Error("boom"));

    expect(await run({ intent: "remove", id })).toBe("error=failed");
    expect(mocks.recordPictureRemoved).not.toHaveBeenCalled();
  });
});

describe("warning", () => {
  it("sends the warning with a reason of the kind of the report", async () => {
    expect(await run({ intent: "warn", id, reason: "harassment" })).toBe(
      "notice=warned",
    );

    expect(mocks.warnPerson).toHaveBeenCalledWith(db, actor, id, "harassment");
  });

  it("takes the reasons of a picture for a report of a picture, and not those of a person", async () => {
    mocks.findReportedPerson.mockResolvedValue(person({ kind: "picture" }));

    expect(await run({ intent: "warn", id, reason: "violent" })).toBe(
      "notice=warned",
    );
    expect(await run({ intent: "warn", id, reason: "harassment" })).toBe(
      "error=invalid_request",
    );
    expect(mocks.warnPerson).toHaveBeenCalledTimes(1);
  });

  it("refuses a reason that is not on the list, and writes nothing", async () => {
    for (const reason of ["", "shout", "<b>x</b>", "copyright"]) {
      expect(await run({ intent: "warn", id, reason })).toBe(
        "error=invalid_request",
      );
    }
    expect(mocks.warnPerson).not.toHaveBeenCalled();
  });

  it("asks to restore or remove a hidden picture first", async () => {
    mocks.findReportedPerson.mockResolvedValue(
      person({ kind: "picture", pictureHidden: true }),
    );

    expect(await run({ intent: "warn", id, reason: "violent" })).toBe(
      "error=picture_hidden",
    );
    expect(mocks.warnPerson).not.toHaveBeenCalled();
  });

  it("does not warn an administrator or oneself", async () => {
    mocks.findReportedPerson.mockResolvedValue(person({ protected: true }));

    expect(await run({ intent: "warn", id, reason: "spam" })).toBe(
      "error=not_allowed",
    );
    expect(mocks.warnPerson).not.toHaveBeenCalled();
  });

  it("says not found for a report that is not open", async () => {
    mocks.findReportedPerson.mockResolvedValue(null);

    expect(await run({ intent: "warn", id, reason: "spam" })).toBe(
      "error=not_found",
    );
  });

  it("does not use Clerk: a warning is only a notification", async () => {
    await run({ intent: "warn", id, reason: "spam" });

    for (const call of Object.values(clerk)) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});

describe("suspending", () => {
  it("locks the account in Clerk first, and then keeps the state here", async () => {
    expect(await run({ intent: "suspend", id })).toBe("notice=suspended");

    expect(mocks.lockUser).toHaveBeenCalledWith("clerk_9");
    expect(mocks.restrictAccount).toHaveBeenCalledWith(
      db,
      actor,
      id,
      "suspended",
    );
    expect(order(mocks.lockUser)).toBeLessThan(order(mocks.restrictAccount));
    expect(mocks.banUser).not.toHaveBeenCalled();
  });

  it("does not suspend an account that is suspended or banned", async () => {
    for (const state of ["suspended", "banned"]) {
      mocks.findReportedPerson.mockResolvedValue(person({ state }));
      expect(await run({ intent: "suspend", id })).toBe("error=not_found");
    }
    expect(mocks.lockUser).not.toHaveBeenCalled();
    expect(mocks.restrictAccount).not.toHaveBeenCalled();
  });

  it("changes nothing here when Clerk refuses", async () => {
    mocks.lockUser.mockRejectedValue(new Error("boom"));

    expect(await run({ intent: "suspend", id })).toBe("error=failed");
    expect(mocks.restrictAccount).not.toHaveBeenCalled();
  });

  it("does not suspend an administrator or oneself, and does not call Clerk", async () => {
    mocks.findReportedPerson.mockResolvedValue(person({ protected: true }));

    expect(await run({ intent: "suspend", id })).toBe("error=not_allowed");
    expect(mocks.lockUser).not.toHaveBeenCalled();
  });
});

describe("banning", () => {
  it("bans the account in Clerk first, and then keeps the state here", async () => {
    expect(await run({ intent: "ban", id })).toBe("notice=banned");

    expect(mocks.banUser).toHaveBeenCalledWith("clerk_9");
    expect(mocks.unlockUser).not.toHaveBeenCalled();
    expect(mocks.restrictAccount).toHaveBeenCalledWith(db, actor, id, "banned");
    expect(order(mocks.banUser)).toBeLessThan(order(mocks.restrictAccount));
  });

  it("unlocks a suspended account before banning it, so lifting the ban leaves nothing locked", async () => {
    mocks.findReportedPerson.mockResolvedValue(person({ state: "suspended" }));

    expect(await run({ intent: "ban", id })).toBe("notice=banned");

    expect(mocks.unlockUser).toHaveBeenCalledWith("clerk_9");
    expect(order(mocks.unlockUser)).toBeLessThan(order(mocks.banUser));
  });

  it("does not ban an account that is banned already", async () => {
    mocks.findReportedPerson.mockResolvedValue(person({ state: "banned" }));

    expect(await run({ intent: "ban", id })).toBe("error=not_found");
    expect(mocks.banUser).not.toHaveBeenCalled();
  });

  it("changes nothing here when Clerk refuses, at either call", async () => {
    mocks.banUser.mockRejectedValue(new Error("boom"));
    expect(await run({ intent: "ban", id })).toBe("error=failed");

    mocks.banUser.mockResolvedValue({});
    mocks.unlockUser.mockRejectedValue(new Error("boom"));
    mocks.findReportedPerson.mockResolvedValue(person({ state: "suspended" }));
    expect(await run({ intent: "ban", id })).toBe("error=failed");

    expect(mocks.restrictAccount).not.toHaveBeenCalled();
  });

  it("says not found when the write here finds nothing to change", async () => {
    mocks.restrictAccount.mockResolvedValue(false);

    expect(await run({ intent: "ban", id })).toBe("error=not_found");
  });

  it("does not ban an administrator or oneself, and does not call Clerk", async () => {
    mocks.findReportedPerson.mockResolvedValue(person({ protected: true }));

    expect(await run({ intent: "ban", id })).toBe("error=not_allowed");
    expect(mocks.banUser).not.toHaveBeenCalled();
  });
});

describe("lifting", () => {
  it("unbans a banned account in Clerk first, and then gives it back here", async () => {
    expect(await run({ intent: "lift", id })).toBe("notice=lifted");

    expect(mocks.findRestrictedAccount).toHaveBeenCalledWith(db, id);
    expect(mocks.unbanUser).toHaveBeenCalledWith("clerk_9");
    expect(mocks.unlockUser).not.toHaveBeenCalled();
    expect(mocks.liftRestriction).toHaveBeenCalledWith(db, actor, id);
    expect(order(mocks.unbanUser)).toBeLessThan(order(mocks.liftRestriction));
  });

  it("unlocks a suspended account", async () => {
    mocks.findRestrictedAccount.mockResolvedValue({
      clerkId: "clerk_9",
      state: "suspended",
    });

    expect(await run({ intent: "lift", id })).toBe("notice=lifted");

    expect(mocks.unlockUser).toHaveBeenCalledWith("clerk_9");
    expect(mocks.unbanUser).not.toHaveBeenCalled();
  });

  it("says not found for an account that is not restricted, with no call to Clerk", async () => {
    mocks.findRestrictedAccount.mockResolvedValue(null);

    expect(await run({ intent: "lift", id })).toBe("error=not_found");
    expect(mocks.unbanUser).not.toHaveBeenCalled();
    expect(mocks.liftRestriction).not.toHaveBeenCalled();
  });

  it("changes nothing here when Clerk refuses", async () => {
    mocks.unbanUser.mockRejectedValue(new Error("boom"));

    expect(await run({ intent: "lift", id })).toBe("error=failed");
    expect(mocks.liftRestriction).not.toHaveBeenCalled();
  });
});

describe("the logs", () => {
  it("name the error of Clerk and never its message", async () => {
    mocks.banUser.mockRejectedValue(
      Object.assign(new Error("secret detail"), {
        name: "ClerkAPIResponseError",
      }),
    );

    await run({ intent: "ban", id });

    expect(console.error).toHaveBeenCalledWith(
      "moderation: Clerk refused",
      "ClerkAPIResponseError",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secret detail",
    );
  });
});
