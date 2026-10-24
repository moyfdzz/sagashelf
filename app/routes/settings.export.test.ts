import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.export";
import { action, loader } from "./settings.export";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  exportAccount: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/account/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~server/account/export")>()),
  exportAccount: mocks.exportAccount,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const account = {
  exportedAt: "2026-10-24T01:00:00.000Z",
  profile: {
    username: "ana_reads",
    displayName: "Ana",
    avatarUrl: null,
    bio: "=HYPERLINK(1)",
    locale: "es",
    privacy: "public",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  libraryEntries: [],
  customEntries: [],
  lists: [],
};

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.exportAccount.mockReset().mockResolvedValue(account);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

function submit(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const request = new Request("http://localhost/settings/export", {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

type Answer = { data: { error?: string }; init?: { status?: number } };
const answer = (value: unknown) => value as Answer;

describe("POST /settings/export", () => {
  it("gives the data of the person in the session as a JSON file nobody caches", async () => {
    const result = (await submit({ format: "json" })) as Response;

    expect(mocks.exportAccount).toHaveBeenCalledWith(db, "user-from-session");
    expect(result.headers.get("Content-Type")).toContain("application/json");
    expect(result.headers.get("Content-Disposition")).toBe(
      'attachment; filename="sagashelf-data-2026-10-24.json"',
    );
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.parse(await result.text())).toMatchObject({
      profile: { username: "ana_reads" },
    });
  });

  it("gives the profile as a CSV that a spreadsheet cannot run as a formula", async () => {
    const result = (await submit({ format: "csv" })) as Response;
    const text = await result.text();

    expect(result.headers.get("Content-Type")).toContain("text/csv");
    expect(text.split("\r\n")[0]).toBe("field,value");
    expect(text).toContain("username,ana_reads");
    // The bio starts with "=": a quote in front keeps it as text.
    expect(text).toContain("bio,'=HYPERLINK(1)");
  });

  it("refuses a format that is not on the page, and any other field", async () => {
    expect(answer(await submit({ format: "xml" })).init?.status).toBe(400);
    expect(
      answer(await submit({ format: "json", userId: "someone-else" })).init
        ?.status,
    ).toBe(400);
    expect(mocks.exportAccount).not.toHaveBeenCalled();
  });

  it("refuses a request from another site, and a body that is too big", async () => {
    expect(
      answer(await submit({ format: "json" }, { Origin: "http://evil.test" }))
        .init?.status,
    ).toBe(403);
    expect(
      answer(await submit({ format: "json" }, { "Content-Length": "5000" }))
        .init?.status,
    ).toBe(413);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("sends a visitor without a session to sign in", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/sign-in" },
    });
    mocks.requireUser.mockRejectedValue(redirect);

    await expect(submit({ format: "json" })).rejects.toBe(redirect);
    expect(mocks.exportAccount).not.toHaveBeenCalled();
  });

  it("is rate limited per person", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = (await submit({ format: "json" })) as Response;

    expect(result.status).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain(
      "export:user-from-session",
    );
  });

  it("refuses an account that was erased", async () => {
    mocks.exportAccount.mockResolvedValue(null);

    await expect(submit({ format: "json" })).rejects.toMatchObject({
      init: { status: 403 },
    });
  });
});

describe("GET /settings/export", () => {
  it("is not a page: only the button asks for the file", () => {
    expect(() => loader()).toThrow();
  });
});
