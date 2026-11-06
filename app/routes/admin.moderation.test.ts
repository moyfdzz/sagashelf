import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.moderation";
import { action, headers, loader, meta } from "./admin.moderation";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readAdminWrite: vi.fn(),
  listOpenReports: vi.fn(),
  listSuspiciousUploads: vi.fn(),
  findPictureReport: vi.fn(),
  dismissReport: vi.fn(),
  restorePicture: vi.fn(),
  recordPictureRemoved: vi.fn(),
  getClerkKeys: vi.fn(),
  deleteUserProfileImage: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: { deleteUserProfileImage: mocks.deleteUserProfileImage },
  }),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/auth/admin-write", () => ({
  readAdminWrite: mocks.readAdminWrite,
}));
vi.mock("~server/db/moderation", () => ({
  listOpenReports: mocks.listOpenReports,
  listSuspiciousUploads: mocks.listSuspiciousUploads,
  findPictureReport: mocks.findPictureReport,
  dismissReport: mocks.dismissReport,
  restorePicture: mocks.restorePicture,
  recordPictureRemoved: mocks.recordPictureRemoved,
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
  ...fields,
});

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.listOpenReports.mockReset().mockResolvedValue([report()]);
  mocks.listSuspiciousUploads.mockReset().mockResolvedValue([]);
  mocks.findPictureReport
    .mockReset()
    .mockResolvedValue({ id: reportId, clerkId: "clerk_1", current: true });
  mocks.dismissReport.mockReset().mockResolvedValue(true);
  mocks.restorePicture.mockReset().mockResolvedValue(true);
  mocks.recordPictureRemoved.mockReset().mockResolvedValue(true);
  mocks.deleteUserProfileImage.mockReset().mockResolvedValue({
    imageUrl: "https://img.clerk.com/generated",
    hasImage: false,
    updatedAt: 1_793_900_000_000,
  });
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
  it("asks for an administrator and lists the reports and the uploads", async () => {
    const result = await load();

    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(result).toMatchObject({
      publishableKey: "pk",
      notice: null,
      error: null,
      confirm: null,
      reports: [{ id: reportId, username: "bob", pictureUrl: picture }],
      uploads: [],
    });
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

  it("does not send the address of a picture reported for minors until that one is asked for", async () => {
    mocks.listOpenReports.mockResolvedValue([
      report({ sensitive: true, hidden: true }),
      report({ id: "other", sensitive: true, hidden: true }),
    ]);

    const closed = (await load()) as {
      reports: { pictureUrl: string | null }[];
    };
    expect(closed.reports.map((r) => r.pictureUrl)).toEqual([null, null]);
    expect(JSON.stringify(closed)).not.toContain(picture);

    const opened = (await load(`?view=${reportId}`)) as {
      reports: { pictureUrl: string | null }[];
    };
    expect(opened.reports.map((r) => r.pictureUrl)).toEqual([picture, null]);
  });

  it("never sends an address that is not https", async () => {
    mocks.listOpenReports.mockResolvedValue([
      report({ pictureUrl: "http://img.clerk.com/photo" }),
      report({ id: "two", pictureUrl: "javascript:alert(1)" }),
    ]);

    const result = (await load()) as {
      reports: { pictureUrl: string | null }[];
    };

    expect(result.reports.map((r) => r.pictureUrl)).toEqual([null, null]);
  });

  it("says what happened and what to confirm, only with words and ids it knows", async () => {
    expect(await load("?notice=restored")).toMatchObject({
      notice: "restored",
    });
    expect(await load("?error=outdated")).toMatchObject({ error: "outdated" });
    expect(await load(`?confirm=${reportId}`)).toMatchObject({
      confirm: reportId,
    });
    expect(
      await load("?notice=%3Cb%3E&error=x&confirm=nope&view=nope"),
    ).toMatchObject({ notice: null, error: null, confirm: null });
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

  it("dismisses as the administrator of the session", async () => {
    const response = await submit({ intent: "dismiss", id: reportId });

    expect(mocks.dismissReport).toHaveBeenCalledWith(
      { fake: "database" },
      "admin-1",
      reportId,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/admin/moderation?notice=dismissed",
    );
  });

  it("restores as the administrator of the session", async () => {
    const response = await submit({ intent: "restore", id: reportId });

    expect(mocks.restorePicture).toHaveBeenCalledWith(
      { fake: "database" },
      "admin-1",
      reportId,
    );
    expect(response.headers.get("Location")).toBe(
      "/admin/moderation?notice=restored",
    );
  });

  it("says not found when the data function changed nothing", async () => {
    mocks.dismissReport.mockResolvedValue(false);
    mocks.restorePicture.mockResolvedValue(false);

    for (const intent of ["dismiss", "restore"]) {
      const response = await submit({ intent, id: reportId });
      expect(response.headers.get("Location")).toBe(
        "/admin/moderation?error=not_found",
      );
    }
  });

  it("deletes the picture in Clerk first, and then writes what Clerk answered", async () => {
    const response = await submit({ intent: "remove", id: reportId });

    expect(mocks.deleteUserProfileImage).toHaveBeenCalledWith("clerk_1");
    expect(mocks.recordPictureRemoved).toHaveBeenCalledWith(
      { fake: "database" },
      "admin-1",
      reportId,
      {
        avatarUrl: "https://img.clerk.com/generated",
        hasOwnPicture: false,
        updatedAt: new Date(1_793_900_000_000),
      },
    );
    expect(
      mocks.deleteUserProfileImage.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.recordPictureRemoved.mock.invocationCallOrder[0] ?? 0);
    expect(response.headers.get("Location")).toBe(
      "/admin/moderation?notice=removed",
    );
  });

  it("does not store an address that is not https", async () => {
    mocks.deleteUserProfileImage.mockResolvedValue({
      imageUrl: "http://img.clerk.com/generated",
      hasImage: false,
      updatedAt: 1,
    });

    await submit({ intent: "remove", id: reportId });

    expect(mocks.recordPictureRemoved.mock.calls[0]?.[3].avatarUrl).toBeNull();
  });

  it("touches nothing in Clerk for a report that is not open, or not of a picture", async () => {
    mocks.findPictureReport.mockResolvedValue(null);

    const response = await submit({ intent: "remove", id: reportId });

    expect(mocks.deleteUserProfileImage).not.toHaveBeenCalled();
    expect(mocks.recordPictureRemoved).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe(
      "/admin/moderation?error=not_found",
    );
  });

  it("does not delete a picture the person has replaced since", async () => {
    mocks.findPictureReport.mockResolvedValue({
      id: reportId,
      clerkId: "clerk_1",
      current: false,
    });

    const response = await submit({ intent: "remove", id: reportId });

    expect(mocks.deleteUserProfileImage).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe(
      "/admin/moderation?error=outdated",
    );
  });

  it("changes nothing here when Clerk refuses", async () => {
    mocks.deleteUserProfileImage.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await submit({ intent: "remove", id: reportId });

    expect(mocks.recordPictureRemoved).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe(
      "/admin/moderation?error=failed",
    );
  });

  it("writes nothing for a form that is not an action, or that carries more", async () => {
    const forms: Record<string, string>[] = [
      { intent: "ban", id: reportId },
      { intent: "dismiss", id: "not-an-id" },
      { intent: "dismiss" },
      { intent: "dismiss", id: reportId, status: "resolved" },
    ];
    for (const form of forms) {
      const response = await submit(form);
      expect(response.headers.get("Location")).toBe(
        "/admin/moderation?error=invalid_request",
      );
    }
    expect(mocks.dismissReport).not.toHaveBeenCalled();
    expect(mocks.restorePicture).not.toHaveBeenCalled();
    expect(mocks.deleteUserProfileImage).not.toHaveBeenCalled();
  });

  it("lets the refusals of the write checks through, and writes nothing", async () => {
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
    expect(mocks.dismissReport).not.toHaveBeenCalled();
  });
});
