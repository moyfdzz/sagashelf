import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  failed,
  isPlanRefusal,
  liftAccount,
  refusalDetail,
  stopAccount,
  viaClerk,
  type ClerkUsers,
} from "./clerk-steps";

/** What `@clerk/backend` throws: an error with the status and a list of errors with a code. */
const clerkError = (status: number, codes: string[], message = "a message") =>
  Object.assign(new Error(message), {
    name: "ClerkAPIResponseError",
    status,
    errors: codes.map((code) => ({ code, message, longMessage: message })),
  });

/** What Clerk throws when its plan does not include the ban. */
const planError = () =>
  clerkError(402, ["unsupported_subscription_plan_features"]);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("refusalDetail (SAG-151)", () => {
  it("gives the status and the codes of the errors of Clerk", () => {
    expect(refusalDetail(clerkError(403, ["feature_not_enabled"]))).toBe(
      "403 feature_not_enabled",
    );
    expect(refusalDetail(clerkError(422, ["a_code", "b_code"]))).toBe(
      "422 a_code b_code",
    );
  });

  it("takes at most two codes", () => {
    expect(refusalDetail(clerkError(400, ["a", "b", "c", "d"]))).toBe(
      "400 a b",
    );
  });

  it("never carries the message, which can carry names", () => {
    const detail = refusalDetail(
      clerkError(404, ["not_found"], "User ana@example.test was not found"),
    );

    expect(detail).toBe("404 not_found");
    expect(detail).not.toContain("ana");
  });

  it("gives the status alone when there are no codes, and the codes alone when there is no status", () => {
    expect(refusalDetail(clerkError(500, []))).toBe("500");
    expect(refusalDetail({ errors: [{ code: "only_code" }] })).toBe(
      "only_code",
    );
  });

  it("falls back to the name of an error that is not one of Clerk", () => {
    expect(refusalDetail(new TypeError("fetch failed"))).toBe("TypeError");
    expect(refusalDetail(new Error("boom"))).toBe("Error");
  });

  it("falls back to a word when there is nothing to say", () => {
    for (const thrown of [undefined, null, "boom", 42, {}, { errors: "x" }]) {
      expect(refusalDetail(thrown)).toBe("error");
    }
  });

  it("ignores entries of the list that are not codes", () => {
    expect(
      refusalDetail({
        status: 400,
        errors: [null, 7, { code: 5 }, {}, { code: "good_one" }],
      }),
    ).toBe("400 good_one");
  });

  it("keeps only characters that are safe in an address and a log, and at most 60", () => {
    expect(
      refusalDetail({ status: 400, errors: [{ code: "bad&code=x<script>" }] }),
    ).toBe("400 badcodexscript");
    expect(refusalDetail({ errors: [{ code: "x".repeat(200) }] })).toHaveLength(
      60,
    );
    expect(refusalDetail({ errors: [{ code: "<>&%" }] })).toBe("error");
  });
});

describe("failed", () => {
  it("is the answer of the panel with the detail encoded in the address", () => {
    expect(failed("403 feature_not_enabled")).toBe(
      "error=failed&detail=403%20feature_not_enabled",
    );
  });
});

describe("viaClerk", () => {
  it("is null when the call went well", async () => {
    expect(await viaClerk(async () => ({}))).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("gives the detail when Clerk refused, and logs that and nothing more", async () => {
    const detail = await viaClerk(async () => {
      throw clerkError(
        403,
        ["feature_not_enabled"],
        "secret detail of a person",
      );
    });

    expect(detail).toBe("403 feature_not_enabled");
    expect(console.error).toHaveBeenCalledWith(
      "moderation: Clerk refused",
      "403 feature_not_enabled",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secret detail",
    );
  });
});

describe("stopAccount", () => {
  const clerk = {
    banUser: vi.fn(),
    unlockUser: vi.fn(),
    getUser: vi.fn(),
  } as unknown as ClerkUsers;
  const account = { clerkId: "clerk_9", state: "active" as const };

  beforeEach(() => {
    vi.mocked(clerk.banUser)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(clerk.unlockUser)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(clerk.getUser)
      .mockReset()
      .mockResolvedValue({
        locked: false,
      } as never);
  });

  it("asks nothing of Clerk for a suspension", async () => {
    expect(await stopAccount(clerk, account, false)).toEqual({
      refused: null,
      skipped: false,
    });
    expect(clerk.banUser).not.toHaveBeenCalled();
  });

  it("bans, and says why when Clerk refuses", async () => {
    expect(await stopAccount(clerk, account, true)).toEqual({
      refused: null,
      skipped: false,
    });

    vi.mocked(clerk.banUser).mockRejectedValue(clerkError(403, ["forbidden"]));
    expect(await stopAccount(clerk, account, true)).toEqual({
      refused: "403 forbidden",
      skipped: false,
    });
  });

  it("says why when Clerk cannot tell whether a suspended account is locked", async () => {
    vi.mocked(clerk.getUser).mockRejectedValue(clerkError(404, ["not_found"]));

    expect(
      await stopAccount(clerk, { ...account, state: "suspended" }, true),
    ).toEqual({ refused: "404 not_found", skipped: false });
    expect(clerk.banUser).not.toHaveBeenCalled();
  });

  it("skips the ban, and refuses nothing, when the plan of Clerk has none (SAG-153)", async () => {
    vi.mocked(clerk.banUser).mockRejectedValue(planError());

    expect(await stopAccount(clerk, account, true)).toEqual({
      refused: null,
      skipped: true,
    });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("liftAccount (SAG-153)", () => {
  const clerk = {
    unbanUser: vi.fn(),
    unlockUser: vi.fn(),
    getUser: vi.fn(),
  } as unknown as ClerkUsers;
  const banned = { clerkId: "clerk_9", state: "banned" as const };

  beforeEach(() => {
    vi.mocked(clerk.unbanUser)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(clerk.getUser)
      .mockReset()
      .mockResolvedValue({ locked: false } as never);
  });

  it("unbans a banned account, and skips it when the plan has no ban", async () => {
    expect(await liftAccount(clerk, banned)).toEqual({
      refused: null,
      skipped: false,
    });

    vi.mocked(clerk.unbanUser).mockRejectedValue(planError());
    expect(await liftAccount(clerk, banned)).toEqual({
      refused: null,
      skipped: true,
    });

    vi.mocked(clerk.unbanUser).mockRejectedValue(clerkError(500, ["x"]));
    expect(await liftAccount(clerk, banned)).toEqual({
      refused: "500 x",
      skipped: false,
    });
  });

  it("never skips a refusal when releasing the lock of a suspension", async () => {
    vi.mocked(clerk.getUser).mockRejectedValue(planError());

    expect(await liftAccount(clerk, { ...banned, state: "suspended" })).toEqual(
      {
        refused: "402 unsupported_subscription_plan_features",
        skipped: false,
      },
    );
    expect(clerk.unbanUser).not.toHaveBeenCalled();
  });
});

describe("isPlanRefusal (SAG-153)", () => {
  it("is true only for 402 with the plan code", () => {
    expect(isPlanRefusal(planError())).toBe(true);
    expect(
      isPlanRefusal(
        clerkError(403, ["unsupported_subscription_plan_features"]),
      ),
    ).toBe(false);
    expect(isPlanRefusal(clerkError(402, ["other"]))).toBe(false);
    expect(isPlanRefusal(clerkError(402, []))).toBe(false);
    expect(isPlanRefusal(new Error("boom"))).toBe(false);
    expect(isPlanRefusal(null)).toBe(false);
    expect(isPlanRefusal({ status: 402, errors: [null] })).toBe(false);
  });
});
