import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/u.$username.report";
import { action, loader } from "./u.$username.report";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  findProfile: vi.fn(),
  createReport: vi.fn(),
  cancelReport: vi.fn(),
  findMyReports: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/profile-lookup", () => ({
  findProfile: mocks.findProfile,
}));
vi.mock("~server/db/reports", () => ({
  createReport: mocks.createReport,
  cancelReport: mocks.cancelReport,
  findMyReports: mocks.findMyReports,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const db = { fake: "database" };
const session = { id: "user-1", clerkId: "clerk_1", role: "user" };
const picture = "https://img.clerk.com/bob";
const owner = {
  id: "bob-id",
  username: "bob_reads",
  displayName: "Bob",
  avatarUrl: picture,
  hasOwnPicture: true,
};
const someId = "018f0000-0000-7000-8000-000000000000";

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.findProfile
    .mockReset()
    .mockResolvedValue({ owner, relationship: "none", view: "card" });
  mocks.createReport.mockReset().mockResolvedValue("reported");
  mocks.cancelReport.mockReset().mockResolvedValue(true);
  mocks.findMyReports
    .mockReset()
    .mockResolvedValue({ user: null, picture: null });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

function send(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  username = "bob_reads",
) {
  const request = new Request(`http://localhost/u/${username}/report`, {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: new URLSearchParams(fields),
  });
  return action({
    request,
    params: { username },
    context: {},
  } as unknown as Route.ActionArgs);
}

const open = (target: string, username = "bob_reads") =>
  loader({
    request: new Request(
      `http://localhost/u/${username}/report?target=${target}`,
    ),
    params: { username },
    context: {},
  } as unknown as Route.LoaderArgs);

type Answer = { data: { error?: string }; init?: { status?: number } };
const answer = (value: unknown) => value as Answer;
const whereTo = (value: unknown) => (value as Response).headers.get("Location");

describe("POST /u/:username/report", () => {
  it("records a report with the picture of the server, and goes back to the profile", async () => {
    const result = await send({
      intent: "report",
      kind: "picture",
      reason: "violent",
      details: "  why  ",
    });

    expect(mocks.createReport).toHaveBeenCalledWith(db, {
      reporterId: "user-1",
      targetId: "bob-id",
      kind: "picture",
      reason: "violent",
      details: "why",
      pictureUrl: picture,
    });
    expect(whereTo(result)).toBe("/u/bob_reads?notice=report_reported");
  });

  it("keeps no picture on a report of the person", async () => {
    await send({ intent: "report", kind: "user", reason: "spam" });

    expect(mocks.createReport).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        kind: "user",
        details: null,
        pictureUrl: null,
      }),
    );
  });

  it.each(["duplicate", "limit"])("says %s to the person", async (outcome) => {
    mocks.createReport.mockResolvedValue(outcome);

    const result = await send({
      intent: "report",
      kind: "user",
      reason: "spam",
    });

    expect(whereTo(result)).toBe(`/u/bob_reads?notice=report_${outcome}`);
  });

  it("refuses a person reporting themselves, like somebody who does not exist", async () => {
    mocks.findProfile.mockResolvedValue({
      owner,
      relationship: "owner",
      view: "full",
    });

    await expect(
      send({ intent: "report", kind: "user", reason: "spam" }),
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("answers the same for a profile that may not be seen", async () => {
    mocks.findProfile.mockResolvedValue(null);

    await expect(
      send({ intent: "report", kind: "user", reason: "spam" }),
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("refuses a report of a picture when there is none, or not over HTTPS", async () => {
    for (const avatarUrl of [null, "http://img.clerk.com/bob"]) {
      mocks.findProfile.mockResolvedValue({
        owner: { ...owner, avatarUrl },
        relationship: "none",
        view: "card",
      });

      await expect(
        send({ intent: "report", kind: "picture", reason: "violent" }),
      ).rejects.toMatchObject({ init: { status: 404 } });
    }
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("refuses a report of the image Clerk generates, and takes one of the person (SAG-144)", async () => {
    mocks.findProfile.mockResolvedValue({
      owner: { ...owner, hasOwnPicture: false },
      relationship: "none",
      view: "card",
    });

    await expect(
      send({ intent: "report", kind: "picture", reason: "violent" }),
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(mocks.createReport).not.toHaveBeenCalled();

    await send({ intent: "report", kind: "user", reason: "spam" });
    expect(mocks.createReport).toHaveBeenCalledTimes(1);
  });

  it("asks for the text of the reason other", async () => {
    const result = answer(
      await send({ intent: "report", kind: "user", reason: "other" }),
    );

    expect(result.data.error).toBe("details_required");
    expect(result.init?.status).toBe(400);
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("refuses a reason of the other kind, and a field the form does not have", async () => {
    const wrong = answer(
      await send({ intent: "report", kind: "user", reason: "sexual_minors" }),
    );
    expect(wrong.data.error).toBe("invalid_request");

    const extra = answer(
      await send({
        intent: "report",
        kind: "picture",
        reason: "violent",
        pictureUrl: "https://evil.example/x",
      }),
    );
    expect(extra.data.error).toBe("invalid_request");
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("cancels only as the person of the session", async () => {
    const result = await send({ intent: "cancel", id: someId });

    expect(mocks.cancelReport).toHaveBeenCalledWith(db, "user-1", someId);
    expect(whereTo(result)).toBe("/u/bob_reads?notice=report_cancelled");
  });

  it("says so when a report could not be cancelled", async () => {
    mocks.cancelReport.mockResolvedValue(false);

    const result = await send({ intent: "cancel", id: someId });

    expect(whereTo(result)).toBe("/u/bob_reads?notice=unavailable");
  });

  it("refuses another site and a big body, before asking who it is", async () => {
    const foreign = answer(
      await send(
        { intent: "report", kind: "user", reason: "spam" },
        { Origin: "https://evil.example" },
      ),
    );
    expect(foreign.init?.status).toBe(403);

    const big = answer(
      await send(
        { intent: "report", kind: "user", reason: "spam" },
        { "Content-Length": String(1024 * 1024) },
      ),
    );
    expect(big.init?.status).toBe(413);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("uses the limit of writes, and past it records nothing", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = await send({
      intent: "report",
      kind: "user",
      reason: "spam",
    });

    expect((result as Response).status).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain("report:user-1");
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("refuses an address that cannot be a username", async () => {
    await expect(
      send({ intent: "report", kind: "user", reason: "spam" }, {}, "a"),
    ).rejects.toMatchObject({ init: { status: 404 } });
  });
});

describe("GET /u/:username/report", () => {
  it("offers the reasons of the kind", async () => {
    const data = await open("user");

    expect(data.kind).toBe("user");
    expect(data.reasons).toContain("spam");
    expect(data.reasons).not.toContain("sexual_minors");
    expect(data.existing).toBeNull();
  });

  it("is a 404 for an unknown target, for the owner and with no picture", async () => {
    await expect(open("list")).rejects.toMatchObject({
      init: { status: 404 },
    });

    mocks.findProfile.mockResolvedValue({
      owner,
      relationship: "owner",
      view: "full",
    });
    await expect(open("user")).rejects.toMatchObject({
      init: { status: 404 },
    });

    mocks.findProfile.mockResolvedValue({
      owner: { ...owner, avatarUrl: null },
      relationship: "none",
      view: "card",
    });
    await expect(open("picture")).rejects.toMatchObject({
      init: { status: 404 },
    });
  });

  it("is a 404 for a picture that is the image Clerk generates", async () => {
    mocks.findProfile.mockResolvedValue({
      owner: { ...owner, hasOwnPicture: false },
      relationship: "none",
      view: "card",
    });

    await expect(open("picture")).rejects.toMatchObject({
      init: { status: 404 },
    });
    expect((await open("user")).kind).toBe("user");
  });

  it("shows a standing report, and lets it go only when it can", async () => {
    mocks.findMyReports.mockResolvedValue({
      user: { id: someId, reason: "spam", status: "open" },
      picture: { id: someId, reason: "sexual_minors", status: "open" },
    });

    expect((await open("user")).existing).toEqual({
      id: someId,
      reason: "spam",
      canCancel: true,
    });
    expect((await open("picture")).existing).toEqual({
      id: someId,
      reason: "sexual_minors",
      canCancel: false,
    });
  });
});
