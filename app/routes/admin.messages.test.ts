import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.messages";
import { action, headers, loader, meta } from "./admin.messages";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readAdminWrite: vi.fn(),
  listContactMessages: vi.fn(),
  runMessageAction: vi.fn(),
  getClerkKeys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/auth/admin-write", () => ({
  readAdminWrite: mocks.readAdminWrite,
}));
vi.mock("~server/db/contact-messages", () => ({
  listContactMessages: mocks.listContactMessages,
}));
vi.mock("~server/contact/messages-panel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~server/contact/messages-panel")>()),
  runMessageAction: mocks.runMessageAction,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const message = (fields: Record<string, unknown> = {}) => ({
  id,
  kind: "problem",
  body: "The search is slow",
  replyEmail: null,
  status: "new",
  username: "ana",
  createdAt: new Date("2026-11-06T22:35:00Z"),
  handledAt: null,
  ...fields,
});

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.listContactMessages.mockReset().mockResolvedValue([message()]);
  mocks.runMessageAction.mockReset().mockResolvedValue("notice=handled");
  mocks.readAdminWrite.mockReset();
});

const load = (search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/admin/messages${search}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

const submit = (form: Record<string, string>) => {
  mocks.readAdminWrite.mockResolvedValue({ user: { id: "admin-1" }, form });
  return action({
    request: new Request("https://sagashelf.app/admin/messages", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs) as Promise<Response>;
};

describe("the page of messages (SAG-110)", () => {
  it("asks for an administrator and lists the messages, with the time as a number", async () => {
    const result = await load();

    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(result).toMatchObject({
      publishableKey: "pk",
      notice: null,
      error: null,
      confirmId: null,
      messages: [
        {
          id,
          kind: "problem",
          body: "The search is slow",
          username: "ana",
          status: "new",
          createdAt: Date.parse("2026-11-06T22:35:00Z"),
        },
      ],
    });
  });

  it("leaves out a message with a kind it does not know", async () => {
    mocks.listContactMessages.mockResolvedValue([
      message({ kind: "weird" }),
      message({ id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70", kind: "help" }),
    ]);

    const result = (await load()) as { messages: { kind: string }[] };

    expect(result.messages.map((m) => m.kind)).toEqual(["help"]);
  });

  it("says what happened and which message to confirm, only with words it knows", async () => {
    expect(await load("?notice=deleted")).toMatchObject({ notice: "deleted" });
    expect(await load("?error=not_found")).toMatchObject({
      error: "not_found",
    });
    expect(await load(`?confirm=${id}`)).toMatchObject({ confirmId: id });
    expect(await load("?notice=%3Cb%3E&error=x&confirm=y")).toMatchObject({
      notice: null,
      error: null,
      confirmId: null,
    });
  });

  it("refuses with 503 when the sign-in is not configured", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    await expect(load()).rejects.toMatchObject({ init: { status: 503 } });
  });

  it("is never kept by a shared cache and is not indexed", () => {
    expect(headers).toBeDefined();
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});

describe("answering a message", () => {
  it("uses the write checks of the administration, with a small limit", async () => {
    await submit({ intent: "handled", id });

    expect(mocks.readAdminWrite).toHaveBeenCalledWith(
      expect.anything(),
      "messages",
      1024,
    );
  });

  it("hands the form, the database and the administrator of the session to the work", async () => {
    await submit({ intent: "delete", id });

    expect(mocks.runMessageAction).toHaveBeenCalledWith(
      { fake: "database" },
      "admin-1",
      { intent: "delete", id },
    );
  });

  it("goes back to the list saying how it went", async () => {
    const ok = await submit({ intent: "handled", id });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe("/admin/messages?notice=handled");

    mocks.runMessageAction.mockResolvedValue("error=not_found");
    const gone = await submit({ intent: "handled", id });
    expect(gone.headers.get("Location")).toBe(
      "/admin/messages?error=not_found",
    );
  });

  it("goes back with an error, and does nothing, for a form it cannot read", async () => {
    for (const form of [
      { intent: "ban", id },
      { intent: "delete", id: "nope" },
      { intent: "delete", id, extra: "x" },
      {},
    ]) {
      const refused = await submit(form as Record<string, string>);
      expect(refused.headers.get("Location")).toBe(
        "/admin/messages?error=invalid_request",
      );
    }
    expect(mocks.runMessageAction).not.toHaveBeenCalled();
  });
});
