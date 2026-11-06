import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.moderation";
import { action, headers, loader, meta } from "./admin.moderation";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readAdminWrite: vi.fn(),
  listOpenReports: vi.fn(),
  listSuspiciousUploads: vi.fn(),
  listRestrictedAccounts: vi.fn(),
  runModerationAction: vi.fn(),
  getClerkKeys: vi.fn(),
  clerkUsers: { marker: "clerk users" },
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ users: mocks.clerkUsers }),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/auth/admin-write", () => ({
  readAdminWrite: mocks.readAdminWrite,
}));
vi.mock("~server/db/moderation", () => ({
  listOpenReports: mocks.listOpenReports,
  listSuspiciousUploads: mocks.listSuspiciousUploads,
  queuePageSize: 50,
}));
vi.mock("~server/db/account-actions", () => ({
  listRestrictedAccounts: mocks.listRestrictedAccounts,
}));
vi.mock("~server/moderation/run-action", () => ({
  runModerationAction: mocks.runModerationAction,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const reportId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const picture = "https://img.clerk.com/photo-one";

const report = (fields: Record<string, unknown> = {}) => ({
  id: reportId,
  kind: "picture",
  reason: "violent",
  details: null,
  createdAt: new Date("2026-11-06T12:00:00Z"),
  username: "bob",
  pictureUrl: picture,
  hidden: false,
  current: true,
  sensitive: false,
  account: "active",
  protected: false,
  ...fields,
});

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.listOpenReports.mockReset().mockResolvedValue([report()]);
  mocks.listSuspiciousUploads.mockReset().mockResolvedValue([]);
  mocks.listRestrictedAccounts.mockReset().mockResolvedValue([]);
  mocks.runModerationAction.mockReset().mockResolvedValue("notice=dismissed");
  mocks.readAdminWrite.mockReset().mockResolvedValue({
    user: { id: "admin-1" },
    form: { intent: "dismiss", id: reportId },
  });
});

const load = (search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/admin/moderation${search}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

type Loaded = {
  confirm: { id: string; action: string } | null;
  reports: {
    pictureUrl: string | null;
    reasonKey: string | null;
    warnReasons: string[];
    warnSelected: string;
  }[];
  accounts: unknown[];
};

const submit = (form: Record<string, string>) => {
  mocks.readAdminWrite.mockResolvedValue({ user: { id: "admin-1" }, form });
  return action({
    request: new Request("https://sagashelf.app/admin/moderation", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs) as Promise<Response>;
};

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as { init?: { status: number } };
  }
  throw new Error("Expected a refusal");
}

describe("the moderation panel (SAG-143)", () => {
  it("asks for an administrator and lists the reports, the restricted accounts and the uploads", async () => {
    mocks.listRestrictedAccounts.mockResolvedValue([
      {
        id: "u1",
        clerkId: "clerk_1",
        username: "carl",
        state: "banned",
        changedAt: new Date("2026-11-06T10:00:00Z"),
      },
    ]);

    const result = await load();

    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    // The reports are asked for with the administrator of the session, to protect their own.
    expect(mocks.listOpenReports).toHaveBeenCalledWith(
      { fake: "database" },
      "admin-1",
    );
    expect(result).toMatchObject({
      publishableKey: "pk",
      notice: null,
      error: null,
      confirm: null,
      reports: [{ id: reportId, username: "bob", pictureUrl: picture }],
      accounts: [
        {
          id: "u1",
          username: "carl",
          state: "banned",
          changedAt: Date.parse("2026-11-06T10:00:00Z"),
        },
      ],
      uploads: [],
    });
  });

  it("does not send the Clerk id of a restricted account to the page", async () => {
    mocks.listRestrictedAccounts.mockResolvedValue([
      {
        id: "u1",
        clerkId: "clerk_secretish",
        username: "carl",
        state: "suspended",
        changedAt: null,
      },
    ]);

    const result = await load();

    expect(JSON.stringify(result)).not.toContain("clerk_secretish");
  });

  it("reads nothing for somebody who is not an administrator, nor with no Clerk keys", async () => {
    const refused = { init: { status: 403 } };
    mocks.requireRole.mockRejectedValue(refused);
    expect(await refusal(load())).toBe(refused);
    expect(mocks.listOpenReports).not.toHaveBeenCalled();

    mocks.requireRole.mockResolvedValue({ id: "admin-1" });
    mocks.getClerkKeys.mockReturnValue(null);
    expect((await refusal(load())).init?.status).toBe(503);
    expect(mocks.listOpenReports).not.toHaveBeenCalled();
  });

  it("gives each report the reasons a warning can use, those of its kind, and starts on its own", async () => {
    mocks.listOpenReports.mockResolvedValue([
      report(),
      report({ id: "two", kind: "user", reason: "spam" }),
      report({ id: "three", kind: "user", reason: "copyright" }),
    ]);

    const { reports } = (await load()) as unknown as Loaded;

    expect(reports[0]).toMatchObject({
      reasonKey: "violent",
      warnSelected: "violent",
    });
    expect(reports[0]?.warnReasons).toEqual([
      "sexual_content",
      "sexual_minors",
      "other_person",
      "violent",
      "other",
    ]);
    expect(reports[1]?.warnReasons).toEqual([
      "spam",
      "harassment",
      "impersonation",
      "hate",
      "other",
    ]);
    // An old reason that has no text is not shown, and the warning starts on "other".
    expect(reports[2]).toMatchObject({
      reasonKey: null,
      warnSelected: "other",
    });
  });

  it("does not send the address of a picture reported for minors until that one is asked for", async () => {
    mocks.listOpenReports.mockResolvedValue([
      report({ sensitive: true, hidden: true }),
      report({ id: "other", sensitive: true, hidden: true }),
    ]);

    const closed = (await load()) as unknown as Loaded;
    expect(closed.reports.map((r) => r.pictureUrl)).toEqual([null, null]);
    expect(JSON.stringify(closed)).not.toContain(picture);

    const opened = (await load(`?view=${reportId}`)) as unknown as Loaded;
    expect(opened.reports.map((r) => r.pictureUrl)).toEqual([picture, null]);
  });

  it("never sends an address that is not https", async () => {
    mocks.listOpenReports.mockResolvedValue([
      report({ pictureUrl: "http://img.clerk.com/photo" }),
      report({ id: "two", pictureUrl: "javascript:alert(1)" }),
    ]);

    const result = (await load()) as unknown as Loaded;

    expect(result.reports.map((r) => r.pictureUrl)).toEqual([null, null]);
  });

  it("says what happened, only with words it knows", async () => {
    for (const notice of ["warned", "suspended", "banned", "lifted"]) {
      expect(await load(`?notice=${notice}`)).toMatchObject({ notice });
    }
    for (const error of ["not_allowed", "picture_hidden", "outdated"]) {
      expect(await load(`?error=${error}`)).toMatchObject({ error });
    }
    expect(await load("?notice=%3Cb%3E&error=x")).toMatchObject({
      notice: null,
      error: null,
    });
  });

  it("asks to confirm an action of the list on a report, and only with both", async () => {
    for (const action of ["remove", "suspend", "ban"]) {
      expect(await load(`?confirm=${reportId}&do=${action}`)).toMatchObject({
        confirm: { id: reportId, action },
      });
    }
    for (const search of [
      `?confirm=${reportId}`,
      "?do=ban",
      `?confirm=${reportId}&do=lift`,
      `?confirm=${reportId}&do=dismiss`,
      "?confirm=nope&do=ban",
    ]) {
      expect(await load(search)).toMatchObject({ confirm: null });
    }
  });

  it("is private and not indexed", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});

describe("answering a report (SAG-143)", () => {
  it("uses the write checks of the administration, with a small limit", async () => {
    await submit({ intent: "dismiss", id: reportId });

    expect(mocks.readAdminWrite).toHaveBeenCalledWith(
      expect.anything(),
      "moderation",
      1024,
    );
  });

  it("hands the form, the database, Clerk and the administrator of the session to the work", async () => {
    await submit({ intent: "ban", id: reportId });

    expect(mocks.runModerationAction).toHaveBeenCalledWith(
      { fake: "database" },
      mocks.clerkUsers,
      "admin-1",
      { intent: "ban", id: reportId },
    );
  });

  it("goes back to the panel saying how it went", async () => {
    mocks.runModerationAction.mockResolvedValue("notice=banned");
    const ok = await submit({ intent: "ban", id: reportId });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe("/admin/moderation?notice=banned");

    mocks.runModerationAction.mockResolvedValue("error=failed");
    const failed = await submit({ intent: "ban", id: reportId });
    expect(failed.headers.get("Location")).toBe(
      "/admin/moderation?error=failed",
    );
  });

  it("passes the reason of a warning, and no other field", async () => {
    await submit({ intent: "warn", id: reportId, reason: "harassment" });

    expect(mocks.runModerationAction.mock.calls[0]?.[3]).toEqual({
      intent: "warn",
      id: reportId,
      reason: "harassment",
    });
  });

  it("writes nothing for a form that is not an action, or that carries more", async () => {
    const forms: Record<string, string>[] = [
      { intent: "delete", id: reportId },
      { intent: "dismiss", id: "not-an-id" },
      { intent: "dismiss" },
      { intent: "dismiss", id: reportId, status: "resolved" },
      { intent: "warn", id: reportId },
      { intent: "ban", id: reportId, reason: "spam" },
      { intent: "lift", id: reportId, role: "admin" },
    ];
    for (const form of forms) {
      const response = await submit(form);
      expect(response.headers.get("Location")).toBe(
        "/admin/moderation?error=invalid_request",
      );
    }
    expect(mocks.runModerationAction).not.toHaveBeenCalled();
  });

  it("is a 503 with no Clerk keys, and does nothing", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    expect(
      (await refusal(submit({ intent: "ban", id: reportId }))).init?.status,
    ).toBe(503);
    expect(mocks.runModerationAction).not.toHaveBeenCalled();
  });

  it("lets the refusals of the write checks through, and does nothing", async () => {
    const refused = { init: { status: 429 } };
    mocks.readAdminWrite.mockRejectedValue(refused);

    expect(
      await refusal(
        action({
          request: new Request("https://sagashelf.app/admin/moderation", {
            method: "POST",
          }),
          params: {},
          context: {},
        } as unknown as Route.ActionArgs),
      ),
    ).toBe(refused);
    expect(mocks.runModerationAction).not.toHaveBeenCalled();
  });
});
