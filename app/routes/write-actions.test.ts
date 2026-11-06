import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authorization test of every write route (SAG-128, part 2). One table, one row per route
 * with an `action`, and the same three questions asked of each: does a page on another site
 * get refused, does a request with no session get refused, and does a request over the rate
 * limit get the 429. The status each route answers is the one it answers today; this test pins
 * it and changes none of them.
 *
 * Only the edges are mocked: who is signed in, the limiter and the database. `checkWrite`,
 * `rateLimit`, `readAdminWrite` and each route's own code run for real, so a route that drops one
 * of them fails here. The route tests next to each route cover what it does after these checks.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireRole: vi.fn(),
  getOptionalUser: vi.fn(),
  getAuth: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  getDb: vi.fn(),
  getWebhooksEnabled: vi.fn(),
  getClerkWebhookSecret: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({
  requireUser: mocks.requireUser,
  requireRole: mocks.requireRole,
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("~server/runtime-env", () => ({
  getWriteLimiter: () => ({ limit: mocks.limit }),
  getSearchLimiter: () => ({ limit: mocks.limit }),
  getDb: mocks.getDb,
  getClerkKeys: () => null,
  getModerationKeys: () => null,
  getWebhooksEnabled: mocks.getWebhooksEnabled,
  getClerkWebhookSecret: mocks.getClerkWebhookSecret,
}));

type Who = "user" | "optional" | "admin" | "none" | "signature";

type Row = {
  /** The route file, as it is in `app/routes`. */
  file: string;
  /** The URL the form is sent to, on this site. */
  path: string;
  params: Record<string, string>;
  who: Who;
  /** What the rate limit key starts with (the limiter adds the caller), or null if it has none. */
  limitKey: string | null;
};

const uuid = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const rows: Row[] = [
  {
    file: "api.locale.ts",
    path: "/api/locale",
    params: {},
    who: "none",
    limitKey: "locale",
  },
  {
    file: "library.$mediaId.tsx",
    path: `/library/${uuid}`,
    params: { mediaId: uuid },
    who: "user",
    limitKey: "library:user-1",
  },
  {
    file: "library.$mediaId.status.ts",
    path: `/library/${uuid}/status`,
    params: { mediaId: uuid },
    who: "user",
    limitKey: "library:user-1",
  },
  {
    file: "library.$mediaId.step.ts",
    path: `/library/${uuid}/step`,
    params: { mediaId: uuid },
    who: "user",
    limitKey: "library:user-1",
  },
  {
    file: "library.add.ts",
    path: "/library/add",
    params: {},
    who: "optional",
    limitKey: "library:user-1",
  },
  {
    file: "library.add-external.ts",
    path: "/library/add-external",
    params: {},
    who: "optional",
    limitKey: "library:user-1",
  },
  {
    file: "notifications.tsx",
    path: "/notifications",
    params: {},
    who: "user",
    limitKey: "notifications:user-1",
  },
  {
    file: "settings.delete.ts",
    path: "/settings/delete",
    params: {},
    who: "user",
    limitKey: "delete:user-1",
  },
  {
    file: "settings.export.ts",
    path: "/settings/export",
    params: {},
    who: "user",
    limitKey: "export:user-1",
  },
  {
    file: "settings.import.tsx",
    path: "/settings/import",
    params: {},
    who: "user",
    limitKey: "import:user-1",
  },
  {
    file: "settings.notifications.tsx",
    path: "/settings/notifications",
    params: {},
    who: "user",
    limitKey: "webhooks:user-1",
  },
  {
    file: "settings.people.tsx",
    path: "/settings/people",
    params: {},
    who: "user",
    limitKey: "social:user-1",
  },
  {
    file: "settings.profile.tsx",
    path: "/settings/profile",
    params: {},
    who: "user",
    limitKey: "profile:user-1",
  },
  {
    file: "settings.avatar.ts",
    path: "/settings/avatar",
    params: {},
    who: "user",
    limitKey: "avatar:user-1",
  },
  {
    file: "settings.username.ts",
    path: "/settings/username",
    params: {},
    who: "user",
    limitKey: "username:user-1",
  },
  {
    file: "u.$username.tsx",
    path: "/u/ana",
    params: { username: "ana" },
    who: "user",
    limitKey: "social:user-1",
  },
  {
    file: "webhooks.clerk.ts",
    path: "/webhooks/clerk",
    params: {},
    who: "signature",
    limitKey: "webhook-clerk",
  },
  {
    file: "admin.sagas.tsx",
    path: "/admin/sagas",
    params: {},
    who: "admin",
    limitKey: "admin:sagas:user-1",
  },
  {
    file: "admin.sagas.$id.tsx",
    path: `/admin/sagas/${uuid}`,
    params: { id: uuid },
    who: "admin",
    limitKey: "admin:sagas:user-1",
  },
];

const origin = "https://sagashelf.app";

function post(row: Row, headers: Record<string, string> = {}) {
  return new Request(`${origin}${row.path}`, {
    method: "POST",
    headers: { Origin: origin, ...headers },
    body: new URLSearchParams({ x: "y" }),
  });
}

// Every route file, loaded only when a test asks for it.
const routeModules = import.meta.glob<{
  action: (args: unknown) => Promise<unknown>;
}>(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"]);

/** Runs the action of a route and says what came out: a status, or the thing it threw. */
async function run(row: Row, request: Request) {
  const load = routeModules[`./${row.file}`];
  if (!load) throw new Error(`no route file ${row.file}`);
  const module = await load();
  try {
    return {
      threw: false as const,
      value: await module.action({ request, params: row.params, context: {} }),
    };
  } catch (error) {
    return { threw: true as const, value: error };
  }
}

/** The HTTP status of an answer, whether it was returned or thrown, as a `Response` or `data()`. */
function statusOf(value: unknown): number | undefined {
  if (value instanceof Response) return value.status;
  const init = (value as { init?: { status?: number } } | null)?.init;
  return init?.status;
}

const signedOut = new Error("signed out");

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.requireRole
    .mockReset()
    .mockResolvedValue({ id: "user-1", role: "admin" });
  mocks.getOptionalUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getAuth
    .mockReset()
    .mockResolvedValue({ has: () => true, userId: "clerk-1" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.getDb.mockReset().mockResolvedValue({ fake: "database" });
  mocks.getWebhooksEnabled.mockReset().mockReturnValue(true);
  mocks.getClerkWebhookSecret
    .mockReset()
    .mockReturnValue("fake-signing-secret");
});

/** Nothing past the checks ran: no session lookup, no limiter, no database. */
function expectNothingElseRan() {
  expect(mocks.requireUser).not.toHaveBeenCalled();
  expect(mocks.requireRole).not.toHaveBeenCalled();
  expect(mocks.getOptionalUser).not.toHaveBeenCalled();
  expect(mocks.limit).not.toHaveBeenCalled();
  expect(mocks.getDb).not.toHaveBeenCalled();
}

describe("every route with an action is in the table", () => {
  const dir = __dirname;
  const withAction = readdirSync(dir).filter(
    (name) =>
      /\.tsx?$/.test(name) &&
      !/\.test\.tsx?$/.test(name) &&
      /export (async )?function action\b/.test(
        readFileSync(join(dir, name), "utf8"),
      ),
  );

  it("finds the routes that write", () => {
    expect(withAction.length).toBeGreaterThan(10);
  });

  it("has a row for each of them, and no row for a file that is gone", () => {
    expect(rows.map((row) => row.file).sort()).toEqual([...withAction].sort());
  });
});

describe.each(rows)("$file", (row) => {
  // Clerk calls its webhook from a server, with no `Origin`, and proves itself by signature.
  if (row.who !== "signature") {
    it("refuses a page of another site before it asks about anything else", async () => {
      const result = await run(
        row,
        post(row, { Origin: "https://evil.example" }),
      );

      expect(statusOf(result.value)).toBe(403);
      expectNothingElseRan();
    });
  }

  if (row.who === "signature") {
    it("refuses a caller that does not prove itself by signature, before the database", async () => {
      const result = await run(row, post(row));

      expect(statusOf(result.value)).toBe(401);
      expect(mocks.getDb).not.toHaveBeenCalled();
    });
  }

  it("refuses a body over the limit before it asks about anything else", async () => {
    const result = await run(row, post(row, { "Content-Length": "99999999" }));

    expect(statusOf(result.value)).toBe(413);
    expectNothingElseRan();
  });

  if (row.who === "user" || row.who === "admin") {
    it("stops when there is no session, before the limit and the database", async () => {
      mocks.requireUser.mockRejectedValue(signedOut);
      mocks.requireRole.mockRejectedValue(signedOut);

      const result = await run(row, post(row));

      expect(result.threw).toBe(true);
      expect(result.value).toBe(signedOut);
      expect(mocks.limit).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled();
    });
  }

  if (row.who === "optional") {
    it("sends a visitor with no session to sign in, before the limit and the database", async () => {
      mocks.getOptionalUser.mockResolvedValue(null);

      const result = await run(row, post(row));

      expect(statusOf(result.value)).toBe(303);
      expect(mocks.limit).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled();
    });
  }

  if (row.limitKey) {
    it("answers 429 over the limit, keyed by the person, before the form is read", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = await run(row, post(row));

      expect(statusOf(result.value)).toBe(429);
      expect(mocks.limit).toHaveBeenCalledTimes(1);
      expect(mocks.limit.mock.calls[0]?.[0].key).toBe(
        `${row.limitKey}:unknown`,
      );
      expect(mocks.getDb).not.toHaveBeenCalled();
    });
  }
});

describe("what some routes ask between the session and the limit", () => {
  const rowOf = (file: string) => {
    const row = rows.find((candidate) => candidate.file === file);
    if (!row) throw new Error(`no row for ${file}`);
    return row;
  };

  it("settings.delete asks for a recent sign-in before the limit", async () => {
    mocks.getAuth.mockResolvedValue({ has: () => false, userId: "clerk-1" });

    const result = await run(
      rowOf("settings.delete.ts"),
      post(rowOf("settings.delete.ts")),
    );

    expect(statusOf(result.value)).toBe(403);
    expect(mocks.requireUser).toHaveBeenCalledTimes(1);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("settings.notifications says 503 with the webhooks off, before the limit", async () => {
    mocks.getWebhooksEnabled.mockReturnValue(false);

    const result = await run(
      rowOf("settings.notifications.tsx"),
      post(rowOf("settings.notifications.tsx")),
    );

    expect(statusOf(result.value)).toBe(503);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("u.$username says 404 to a shape that is no username, before the session", async () => {
    const row = { ...rowOf("u.$username.tsx"), params: { username: "a b" } };

    const result = await run(row, post(row));

    expect(statusOf(result.value)).toBe(404);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
