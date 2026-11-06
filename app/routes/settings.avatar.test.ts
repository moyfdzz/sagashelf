import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.avatar";
import { action, loader } from "./settings.avatar";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  claim: vi.fn(),
  apply: vi.fn(),
  moderate: vi.fn(),
  record: vi.fn(),
  moderationKeys: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: {
      updateUserProfileImage: mocks.update,
      deleteUserProfileImage: mocks.remove,
    },
  }),
}));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: () => ({
    publishableKey: "pk_test_for_the_tests",
    secretKey: "sk_test_for_the_tests",
  }),
  getModerationKeys: mocks.moderationKeys,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/avatar", () => ({
  claimAvatarUpload: mocks.claim,
  applyAvatar: mocks.apply,
}));
vi.mock("~server/db/picture-uploads", () => ({
  recordPictureUpload: mocks.record,
  sha256Hex: async () => "fake-hash",
}));
vi.mock("~server/moderation/sightengine", () => ({
  moderatePicture: mocks.moderate,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const clerkTime = Date.UTC(2026, 10, 5, 12, 0, 0);
const newAddress = "https://img.clerk.com/new-picture";
const moderationKeys = { apiUser: "fake-user", apiSecret: "fake-secret" };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.claim.mockReset().mockResolvedValue("ok");
  mocks.apply.mockReset().mockResolvedValue(true);
  mocks.moderate
    .mockReset()
    .mockResolvedValue({ verdict: "allowed", scores: { erotica: 0.01 } });
  mocks.record.mockReset().mockResolvedValue(undefined);
  mocks.moderationKeys.mockReset().mockReturnValue(moderationKeys);
  mocks.update.mockReset().mockResolvedValue({
    imageUrl: newAddress,
    hasImage: true,
    updatedAt: clerkTime,
  });
  mocks.remove.mockReset().mockResolvedValue({
    imageUrl: newAddress,
    hasImage: true,
    updatedAt: clerkTime,
  });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function formOf(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

function send(body: BodyInit, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/settings/avatar", {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body,
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

// The browser's word for the type is a lie on purpose: only the bytes are asked.
const upload = (bytes: Uint8Array<ArrayBuffer> = jpeg, type = "image/png") =>
  send(
    formOf({
      intent: "upload",
      picture: new File([bytes], "name.png", { type }),
    }),
  );

type Answer = {
  data: { ok?: boolean; error?: string };
  init?: { status?: number };
};
const answer = (value: unknown) => value as Answer;

function expectNothingSaved() {
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
}

describe("POST /settings/avatar, uploading", () => {
  it("checks the picture, gives it to Clerk, then writes the address here with Clerk's time", async () => {
    const result = answer(await upload());

    expect(result.data.ok).toBe(true);
    expect(mocks.claim).toHaveBeenCalledWith(db, "user-from-session");
    expect(mocks.moderate).toHaveBeenCalledWith(
      jpeg,
      "image/jpeg",
      moderationKeys,
    );
    // The Clerk id comes from the session, never from the form.
    const [clerkId, params] = mocks.update.mock.calls[0] as [
      string,
      { file: File },
    ];
    expect(clerkId).toBe("clerk_1");
    expect(params.file.type).toBe("image/jpeg");
    expect(new Uint8Array(await params.file.arrayBuffer())).toEqual(jpeg);
    expect(mocks.apply).toHaveBeenCalledWith(
      db,
      "user-from-session",
      newAddress,
      true,
      new Date(clerkTime),
    );
  });

  it("asks in order: the limit of the day, then the moderation, then Clerk", async () => {
    await upload();

    const order = [mocks.claim, mocks.moderate, mocks.update].map(
      (mock) => mock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each([
    ["allowed", { erotica: 0.01 }],
    ["rejected", { erotica: 0.9 }],
    ["unavailable", null],
  ])(
    "leaves a record of a try that is %s (SAG-142)",
    async (verdict, scores) => {
      mocks.moderate.mockResolvedValue({ verdict, scores });

      const request = new Request("http://localhost/settings/avatar", {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "CF-Connecting-IP": "203.0.113.7",
        },
        body: formOf({
          intent: "upload",
          picture: new File([jpeg], "name.png"),
        }),
      });
      await action({ request, context: {} } as unknown as Route.ActionArgs);

      expect(mocks.record).toHaveBeenCalledWith(db, {
        userId: "user-from-session",
        sha256: "fake-hash",
        result: verdict,
        scores,
        ipAddress: "203.0.113.7",
      });
    },
  );

  it("publishes nothing when the record cannot be written", async () => {
    mocks.record.mockRejectedValue(new Error("database"));

    const result = answer(await upload());

    expect(result.data.error).toBe("failed");
    expect(result.init?.status).toBe(502);
    expectNothingSaved();
  });

  it("leaves no record for a file refused before the moderation", async () => {
    await upload(new TextEncoder().encode("not a picture"));
    mocks.claim.mockResolvedValue("limit");
    await upload();

    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("saves nothing when the moderation refuses the picture", async () => {
    mocks.moderate.mockResolvedValue({ verdict: "rejected", scores: null });

    const result = answer(await upload());

    expect(result.data.error).toBe("rejected");
    expect(result.init?.status).toBe(422);
    expectNothingSaved();
  });

  it("saves nothing when the moderation cannot answer", async () => {
    mocks.moderate.mockResolvedValue({ verdict: "unavailable", scores: null });

    const result = answer(await upload());

    expect(result.data.error).toBe("unavailable");
    expect(result.init?.status).toBe(503);
    expectNothingSaved();
  });

  it("saves nothing and spends nothing when this deployment has no moderation", async () => {
    mocks.moderationKeys.mockReturnValue(null);

    const result = answer(await upload());

    expect(result.data.error).toBe("unavailable");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.moderate).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("asks nothing of the moderation after the limit of the day", async () => {
    mocks.claim.mockResolvedValue("limit");

    const result = answer(await upload());

    expect(result.data.error).toBe("limit");
    expect(result.init?.status).toBe(429);
    expect(mocks.moderate).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("refuses an erased account", async () => {
    mocks.claim.mockResolvedValue("gone");

    await expect(upload()).rejects.toMatchObject({ init: { status: 403 } });
    expect(mocks.moderate).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it.each([
    ["an SVG", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ["a program", "MZ-this-is-not-a-picture"],
    ["a page", "<!doctype html><script>"],
  ])(
    "refuses %s called a PNG, before anything is spent",
    async (_name, text) => {
      const result = answer(await upload(new TextEncoder().encode(text)));

      expect(result.data.error).toBe("invalid_type");
      expect(result.init?.status).toBe(400);
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(mocks.moderate).not.toHaveBeenCalled();
      expectNothingSaved();
    },
  );

  it("refuses a file over the limit, by the header and by what arrives", async () => {
    const big = new Uint8Array(1024 * 1024 + 1).fill(0xff);

    const byHeader = answer(
      await send("x", { "Content-Length": String(2 * 1024 * 1024) }),
    );
    expect(byHeader.data.error).toBe("too_large");
    expect(byHeader.init?.status).toBe(413);

    const byField = answer(await upload(big));
    expect(byField.data.error).toBe("too_large");
    expectNothingSaved();
  });

  it("tells the person when Clerk refuses, and writes nothing here", async () => {
    mocks.update.mockRejectedValue(new Error("no"));

    const result = answer(await upload());

    expect(result.data.error).toBe("failed");
    expect(result.init?.status).toBe(502);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("still answers well when our own write fails: the event of Clerk writes it later", async () => {
    mocks.apply.mockRejectedValue(new Error("database"));

    expect(answer(await upload()).data.ok).toBe(true);
  });

  it("does not write an address that is not HTTPS", async () => {
    mocks.update.mockResolvedValue({
      imageUrl: "http://img.clerk.com/picture",
      hasImage: true,
      updatedAt: clerkTime,
    });

    await upload();

    expect(mocks.apply).toHaveBeenCalledWith(
      db,
      "user-from-session",
      null,
      true,
      new Date(clerkTime),
    );
  });
});

describe("POST /settings/avatar, removing", () => {
  it("removes it in Clerk and writes what Clerk answers, with no moderation", async () => {
    const result = answer(await send(formOf({ intent: "remove" })));

    expect(result.data.ok).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith("clerk_1");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.moderate).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenCalledWith(
      db,
      "user-from-session",
      newAddress,
      true,
      new Date(clerkTime),
    );
  });

  it("writes that the image is now one Clerk generated, as Clerk says (SAG-144)", async () => {
    mocks.remove.mockResolvedValue({
      imageUrl: newAddress,
      hasImage: false,
      updatedAt: clerkTime,
    });

    await send(formOf({ intent: "remove" }));

    expect(mocks.apply).toHaveBeenCalledWith(
      db,
      "user-from-session",
      newAddress,
      false,
      new Date(clerkTime),
    );
  });

  it("tells the person when Clerk refuses", async () => {
    mocks.remove.mockRejectedValue(new Error("no"));

    const result = answer(await send(formOf({ intent: "remove" })));

    expect(result.data.error).toBe("failed");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});

describe("POST /settings/avatar, who may ask", () => {
  it("refuses a page of another site before anything else", async () => {
    const result = answer(
      await send(formOf({ intent: "remove" }), {
        Origin: "https://evil.example",
      }),
    );

    expect(result.init?.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("uses the limit of writes of the person", async () => {
    await upload();

    expect(mocks.limit.mock.calls[0]?.[0].key).toContain(
      "avatar:user-from-session",
    );
  });

  it("saves nothing and spends nothing past that limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    await upload().catch(() => undefined);

    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.moderate).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("refuses a field the form does not have, and a form with no picture", async () => {
    const extra = answer(
      await send(formOf({ intent: "remove", clerkId: "someone_else" })),
    );
    expect(extra.data.error).toBe("invalid_request");

    const empty = answer(await send(formOf({ intent: "upload" })));
    expect(empty.data.error).toBe("invalid_request");
    expectNothingSaved();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("answers a GET with a 405", () => {
    expect(() => loader()).toThrow();
  });
});
