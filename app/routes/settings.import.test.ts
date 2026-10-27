import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.import";
import { action, headers } from "./settings.import";
import { maxImportBytes } from "~server/library/import-file";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  previewImport: vi.fn(),
  runImport: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getMediaProviders: () => [{ id: "tmdb" }],
  getWriteLimiter: () => ({ limit: mocks.limit }),
  getClerkKeys: () => ({
    publishableKey: "publishable-key-for-tests",
    secretKey: "secret-for-tests",
  }),
}));
vi.mock("~server/library/import", () => ({
  previewImport: mocks.previewImport,
  runImport: mocks.runImport,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => "en",
}));

const preview = { add: 1, exists: 0, fetch: 0, skipped: [] };
const result = { added: 1, replaced: 0, kept: 0, skipped: [] };

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-from-session" });
  mocks.previewImport.mockReset().mockResolvedValue(preview);
  mocks.runImport.mockReset().mockResolvedValue(result);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const goodFile = JSON.stringify({
  schemaVersion: 1,
  libraryEntries: [
    {
      title: "Matrix",
      source: { provider: "tmdb", id: "movie/603" },
      status: "completed",
      progress: 0,
      score: 9,
      startedAt: null,
      finishedAt: null,
      notes: null,
      viewings: [],
      userId: "someone-else",
      visibility: "public",
    },
  ],
});

function send(
  fields: Record<string, string | File>,
  headers: Record<string, string> = {},
) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return action({
    request: new Request("https://sagashelf.app/settings/import", {
      method: "POST",
      headers: { Origin: "https://sagashelf.app", ...headers },
      body,
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs);
}

const jsonFile = (text: string) =>
  new File([text], "sagashelf.json", { type: "application/json" });

async function statusOf(promise: Promise<unknown>) {
  try {
    const answer = await promise;
    return (
      (answer as { init?: { status: number } }).init?.status ??
      (answer as Response).status
    );
  } catch (thrown) {
    return (
      (thrown as { init?: { status: number } }).init?.status ??
      (thrown as Response).status
    );
  }
}

describe("the preview", () => {
  it("reads the file and answers with what would happen, writing nothing", async () => {
    const answer = await send({ intent: "preview", file: jsonFile(goodFile) });

    expect(answer).toMatchObject({
      data: { ok: true, step: "preview", preview, payload: goodFile },
    });
    expect(mocks.previewImport).toHaveBeenCalledTimes(1);
    expect(mocks.runImport).not.toHaveBeenCalled();
  });

  it("uses the person of the session, whatever the file says", async () => {
    await send({ intent: "preview", file: jsonFile(goodFile) });

    expect(mocks.previewImport.mock.calls[0]?.[1]).toBe("user-from-session");
    const parsedEntries = mocks.previewImport.mock.calls[0]?.[2].entries;
    expect(JSON.stringify(parsedEntries)).not.toContain("someone-else");
    expect(JSON.stringify(parsedEntries)).not.toContain("public");
  });

  it("answers with a code for a file that is not valid, a missing file and a version it does not know", async () => {
    expect(
      await send({ intent: "preview", file: jsonFile("not json") }),
    ).toMatchObject({ init: { status: 400 }, data: { error: "invalid_file" } });
    expect(await send({ intent: "preview" })).toMatchObject({
      init: { status: 400 },
      data: { error: "file_missing" },
    });
    expect(
      await send({
        intent: "preview",
        file: jsonFile(
          JSON.stringify({ schemaVersion: 9, libraryEntries: [] }),
        ),
      }),
    ).toMatchObject({ data: { error: "unsupported_version" } });
    expect(mocks.previewImport).not.toHaveBeenCalled();
  });

  it("refuses a file over the limit", async () => {
    const big = jsonFile(" ".repeat(maxImportBytes + 1));

    expect(await send({ intent: "preview", file: big })).toMatchObject({
      init: { status: 413 },
      data: { error: "file_too_large" },
    });
  });
});

describe("the import", () => {
  it("reads the file again and imports it, with the choice to replace", async () => {
    const answer = await send({
      intent: "confirm",
      payload: goodFile,
      replace: "on",
    });

    expect(answer).toMatchObject({
      data: { ok: true, step: "done", result },
    });
    expect(mocks.runImport).toHaveBeenCalledWith(
      expect.anything(),
      "user-from-session",
      expect.objectContaining({ entries: expect.any(Array) }),
      { replace: true, locale: "en" },
    );
  });

  it("does not replace unless asked", async () => {
    await send({ intent: "confirm", payload: goodFile });

    expect(mocks.runImport.mock.calls[0]?.[3]).toMatchObject({
      replace: false,
    });
  });

  it("validates the file again, so a changed payload is not trusted", async () => {
    expect(
      await send({ intent: "confirm", payload: '{"schemaVersion":1}' }),
    ).toMatchObject({ data: { error: "invalid_file" } });
    expect(mocks.runImport).not.toHaveBeenCalled();
  });
});

describe("who may ask", () => {
  it("refuses a request from another site", async () => {
    expect(
      await statusOf(
        send(
          { intent: "preview", file: jsonFile(goodFile) },
          { Origin: "https://evil.example" },
        ),
      ),
    ).toBe(403);
    expect(mocks.previewImport).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit before reading it", async () => {
    expect(
      await statusOf(
        send(
          { intent: "preview", file: jsonFile(goodFile) },
          { "Content-Length": String(maxImportBytes * 2) },
        ),
      ),
    ).toBe(413);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("limits the writes per person", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    expect(
      await statusOf(send({ intent: "preview", file: jsonFile(goodFile) })),
    ).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain(
      "import:user-from-session",
    );
    expect(mocks.previewImport).not.toHaveBeenCalled();
  });

  it("refuses a field the form does not have", async () => {
    expect(
      await send({ intent: "confirm", payload: goodFile, userId: "other" }),
    ).toMatchObject({ init: { status: 400 }, data: { error: "generic" } });
    expect(mocks.runImport).not.toHaveBeenCalled();
  });
});

describe("the headers", () => {
  it("are never kept by a shared cache", () => {
    const merged = headers({
      actionHeaders: new Headers(),
      loaderHeaders: new Headers(),
    } as unknown as Route.HeadersArgs);

    expect(merged.get("Cache-Control")).toBe("private, no-store");
  });
});
