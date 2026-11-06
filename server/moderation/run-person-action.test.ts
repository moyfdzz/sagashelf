import { beforeEach, describe, expect, it, vi } from "vitest";

import { runModerationAction, type ClerkUsers } from "./run-action";

const mocks = vi.hoisted(() => ({
  findPersonByUsername: vi.fn(),
  findReportedPerson: vi.fn(),
  findRestrictedAccount: vi.fn(),
  liftRestriction: vi.fn(),
  restrictAccount: vi.fn(),
  warnPerson: vi.fn(),
  banUser: vi.fn(),
  lockUser: vi.fn(),
  unlockUser: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../db/account-actions", () => ({
  findPersonByUsername: mocks.findPersonByUsername,
  findReportedPerson: mocks.findReportedPerson,
  findRestrictedAccount: mocks.findRestrictedAccount,
  liftRestriction: mocks.liftRestriction,
  restrictAccount: mocks.restrictAccount,
  warnPerson: mocks.warnPerson,
}));
vi.mock("../db/moderation", () => ({
  dismissReport: vi.fn(),
  findPictureReport: vi.fn(),
  recordPictureRemoved: vi.fn(),
  restorePicture: vi.fn(),
}));

const db = { execute: vi.fn() };
const clerk = {
  deleteUserProfileImage: vi.fn(),
  banUser: mocks.banUser,
  unbanUser: vi.fn(),
  lockUser: mocks.lockUser,
  unlockUser: mocks.unlockUser,
  getUser: mocks.getUser,
} as unknown as ClerkUsers;

const actor = "admin-1";
const username = "bob_reads";

const person = (fields: Record<string, unknown> = {}) => ({
  userId: "user-9",
  clerkId: "clerk_9",
  username,
  displayName: "Bob",
  state: "active",
  protected: false,
  ...fields,
});

const run = (form: Record<string, unknown>) =>
  runModerationAction(db, clerk, actor, form as never);

const order = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.findPersonByUsername.mockResolvedValue(person());
  mocks.warnPerson.mockResolvedValue(true);
  mocks.restrictAccount.mockResolvedValue(true);
  mocks.getUser.mockResolvedValue({ locked: false });
  for (const call of [mocks.banUser, mocks.lockUser, mocks.unlockUser]) {
    call.mockResolvedValue({});
  }
});

describe("a warning to a person with no report (SAG-146)", () => {
  it("finds the person by username, and warns them with the reason and the note", async () => {
    expect(
      await run({
        intent: "warn_person",
        username,
        reason: "harassment",
        note: "seen in the comments",
      }),
    ).toBe("person=bob_reads&notice=warned");

    expect(mocks.findPersonByUsername).toHaveBeenCalledWith(
      db,
      actor,
      username,
    );
    // The subject is the id the server found, never a field of the form.
    expect(mocks.warnPerson).toHaveBeenCalledWith(
      db,
      actor,
      { userId: "user-9" },
      "harassment",
      "seen in the comments",
    );
  });

  it("takes only the reasons for a person, and writes nothing for another", async () => {
    for (const reason of [
      "violent",
      "sexual_minors",
      "",
      "shout",
      "copyright",
    ]) {
      expect(await run({ intent: "warn_person", username, reason })).toBe(
        "person=bob_reads&error=invalid_request",
      );
    }
    expect(mocks.warnPerson).not.toHaveBeenCalled();
  });

  it("does not use Clerk", async () => {
    await run({ intent: "warn_person", username, reason: "spam" });

    expect(mocks.banUser).not.toHaveBeenCalled();
    expect(mocks.lockUser).not.toHaveBeenCalled();
  });
});

describe("suspending and banning a person with no report (SAG-146)", () => {
  it("keeps the state here, with the note, and asks nothing of Clerk", async () => {
    expect(
      await run({ intent: "suspend_person", username, note: "spam in lists" }),
    ).toBe("person=bob_reads&notice=suspended");

    expect(mocks.restrictAccount).toHaveBeenCalledWith(
      db,
      actor,
      { userId: "user-9" },
      "suspended",
      "spam in lists",
    );
    // The app enforces a suspension on every request, and the lock of Clerk expires (SAG-148).
    for (const call of Object.values(clerk)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("bans in Clerk first and then keeps the state here", async () => {
    expect(await run({ intent: "ban_person", username, note: null })).toBe(
      "person=bob_reads&notice=banned",
    );

    expect(mocks.banUser).toHaveBeenCalledWith("clerk_9");
    expect(mocks.unlockUser).not.toHaveBeenCalled();
    expect(mocks.restrictAccount).toHaveBeenCalledWith(
      db,
      actor,
      { userId: "user-9" },
      "banned",
      null,
    );
    expect(order(mocks.banUser)).toBeLessThan(order(mocks.restrictAccount));
  });

  it("releases an old lock of a suspended account before banning it", async () => {
    mocks.findPersonByUsername.mockResolvedValue(
      person({ state: "suspended" }),
    );
    mocks.getUser.mockResolvedValue({ locked: true });

    await run({ intent: "ban_person", username });

    expect(order(mocks.unlockUser)).toBeLessThan(order(mocks.banUser));
  });

  it("does not unlock a suspended account that has no lock", async () => {
    mocks.findPersonByUsername.mockResolvedValue(
      person({ state: "suspended" }),
    );

    await run({ intent: "ban_person", username });

    expect(mocks.unlockUser).not.toHaveBeenCalled();
    expect(mocks.banUser).toHaveBeenCalledWith("clerk_9");
  });

  it("does not suspend what is suspended or banned, nor ban what is banned", async () => {
    mocks.findPersonByUsername.mockResolvedValue(person({ state: "banned" }));
    expect(await run({ intent: "ban_person", username })).toBe(
      "person=bob_reads&error=not_found",
    );
    expect(await run({ intent: "suspend_person", username })).toBe(
      "person=bob_reads&error=not_found",
    );
    mocks.findPersonByUsername.mockResolvedValue(
      person({ state: "suspended" }),
    );
    expect(await run({ intent: "suspend_person", username })).toBe(
      "person=bob_reads&error=not_found",
    );

    expect(mocks.lockUser).not.toHaveBeenCalled();
    expect(mocks.banUser).not.toHaveBeenCalled();
    expect(mocks.restrictAccount).not.toHaveBeenCalled();
  });

  it("changes nothing here when Clerk refuses the ban", async () => {
    mocks.banUser.mockRejectedValue(new Error("boom"));

    expect(await run({ intent: "ban_person", username })).toBe(
      "person=bob_reads&error=failed&detail=Error",
    );
    expect(mocks.restrictAccount).not.toHaveBeenCalled();
  });

  it("says not found when the write here finds nothing to change", async () => {
    mocks.restrictAccount.mockResolvedValue(false);

    expect(await run({ intent: "ban_person", username })).toBe(
      "person=bob_reads&error=not_found",
    );
  });
});

describe("who can be acted on directly (SAG-146)", () => {
  it.each(["warn_person", "suspend_person", "ban_person"])(
    "says not found for a username that does not exist, with %s",
    async (intent) => {
      mocks.findPersonByUsername.mockResolvedValue(null);

      expect(await run({ intent, username, reason: "spam" })).toBe(
        "person=bob_reads&error=not_found",
      );
      expect(mocks.warnPerson).not.toHaveBeenCalled();
      expect(mocks.lockUser).not.toHaveBeenCalled();
    },
  );

  it.each(["warn_person", "suspend_person", "ban_person"])(
    "does not act on an administrator or oneself, and does not call Clerk, with %s",
    async (intent) => {
      mocks.findPersonByUsername.mockResolvedValue(person({ protected: true }));

      expect(await run({ intent, username, reason: "spam" })).toBe(
        "person=bob_reads&error=not_allowed",
      );
      expect(mocks.warnPerson).not.toHaveBeenCalled();
      expect(mocks.lockUser).not.toHaveBeenCalled();
      expect(mocks.banUser).not.toHaveBeenCalled();
      expect(mocks.restrictAccount).not.toHaveBeenCalled();
    },
  );

  it("puts the username of the answer in the address, safely", async () => {
    mocks.findPersonByUsername.mockResolvedValue(null);

    expect(
      await run({ intent: "ban_person", username: "a&b=c", note: null }),
    ).toBe("person=a%26b%3Dc&error=not_found");
  });
});
