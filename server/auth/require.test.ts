import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoaderFunctionArgs } from "react-router";

import { getOptionalUser, requireRole, requireUser } from "./require";

const mocks = vi.hoisted(() => ({
  getClerkKeys: vi.fn(),
  getAuth: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("@clerk/backend", () => ({ createClerkClient: vi.fn() }));
vi.mock("../runtime-env", () => ({
  getClerkKeys: mocks.getClerkKeys,
  getDb: mocks.getDb,
}));

const args = (method = "POST") =>
  ({
    request: new Request("https://sagashelf.app/settings/delete", {
      method,
      body: "intent=delete",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
    params: {},
    context: {},
  }) as unknown as LoaderFunctionArgs;

/** A signed-in person whose row has this state. */
function signedInAs(status: string, role = "user") {
  mocks.getAuth.mockResolvedValue({ userId: "user_1" });
  mocks.getDb.mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "u1", clerkId: "user_1", role, status }],
        }),
      }),
    }),
  });
}

/** A read: a GET has no body. */
const readArgs = () =>
  ({
    request: new Request("https://sagashelf.app/library"),
    params: {},
    context: {},
  }) as unknown as LoaderFunctionArgs;

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as {
      init?: { status: number };
      status?: number;
      headers?: Headers;
    };
  }
  throw new Error("Expected a refusal");
}

beforeEach(() => {
  mocks.getClerkKeys.mockReset().mockReturnValue({ secretKey: "x" });
  mocks.getAuth.mockReset().mockResolvedValue({ userId: null });
  mocks.getDb.mockReset();
});

// A refusal leaves the body alone: the Worker entry drops what is left of it before any answer
// goes out (`answerAndDrain`, SAG-69), so nothing here has to remember it (SAG-73).
describe("requireUser", () => {
  it("says the deployment has no keys, without touching the body", async () => {
    mocks.getClerkKeys.mockReturnValue(null);
    const call = args();

    const thrown = await refusal(requireUser(call));

    expect(thrown.init?.status).toBe(503);
    expect(call.request.bodyUsed).toBe(false);
  });

  it("sends a visitor to sign in, without touching the body", async () => {
    const call = args();

    const thrown = await refusal(requireUser(call));

    // A redirect to the sign-in page, a whole new document.
    expect(thrown.status).toBe(302);
    expect(call.request.bodyUsed).toBe(false);
  });

  it("refuses a person that has no account, without touching the body", async () => {
    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    });
    const call = args();

    const thrown = await refusal(requireUser(call));

    expect(thrown.init?.status).toBe(403);
    expect(call.request.bodyUsed).toBe(false);
  });

  it("lets the person go in, and the body is for the route to read", async () => {
    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: "u1", clerkId: "user_1", role: "user", status: "active" },
            ],
          }),
        }),
      }),
    });

    const call = args();

    await expect(requireUser(call)).resolves.toMatchObject({ id: "u1" });
    expect(call.request.bodyUsed).toBe(false);
  });

  it("gives the route the person and nothing of the moderation state", async () => {
    signedInAs("active");

    expect(await requireUser(args())).toEqual({
      id: "u1",
      clerkId: "user_1",
      role: "user",
    });
  });

  it.each(["suspended", "banned"])(
    "sends a %s person to the page that says why, as a new document, without touching the body",
    async (status) => {
      signedInAs(status);
      const call = args();

      const thrown = await refusal(requireUser(call));

      expect(thrown.status).toBe(302);
      expect(thrown.headers?.get("Location")).toBe("/account-restricted");
      expect(call.request.bodyUsed).toBe(false);
    },
  );

  it("does not let a restricted administrator into the administration", async () => {
    signedInAs("banned", "admin");

    const thrown = await refusal(requireRole(args(), "admin"));

    expect(thrown.headers?.get("Location")).toBe("/account-restricted");
  });

  it("treats a state it does not know as a restriction, never as permission", async () => {
    signedInAs("exiled");

    const thrown = await refusal(requireUser(args()));

    expect(thrown.headers?.get("Location")).toBe("/account-restricted");
  });
});

describe("getOptionalUser", () => {
  it("is null for a visitor, and the person for an active account", async () => {
    expect(await getOptionalUser(readArgs())).toBeNull();

    signedInAs("active");
    expect(await getOptionalUser(readArgs())).toEqual({
      id: "u1",
      clerkId: "user_1",
      role: "user",
    });
  });

  it.each(["suspended", "banned"])(
    "sends a %s person to the page that says why, and does not show them a page as a visitor",
    async (status) => {
      signedInAs(status);

      const thrown = await refusal(getOptionalUser(readArgs()));

      expect(thrown.status).toBe(302);
      expect(thrown.headers?.get("Location")).toBe("/account-restricted");
    },
  );

  it("does not send a visitor, nor a signed-in person with no account, anywhere", async () => {
    expect(await getOptionalUser(readArgs())).toBeNull();

    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    });
    expect(await getOptionalUser(readArgs())).toBeNull();
  });

  it("is null with no Clerk keys, and does not ask for the session", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    expect(await getOptionalUser(readArgs())).toBeNull();
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });
});

// An erased account keeps its row and its Clerk id, so a token that is still valid must find no
// account (SAG-166). The real filter against Postgres is in `db/session-user.integration.test.ts`;
// here the SQL that the guards send is read, and the three guards answer as for "no account".
describe("an erased account", () => {
  /** A database that has no row for what it is asked, and keeps the condition it was asked. */
  function emptyDatabase() {
    const asked: unknown[] = [];
    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            asked.push(condition);
            return { limit: async () => [] };
          },
        }),
      }),
    });
    return asked;
  }

  it("is left out by the query of every guard", async () => {
    const asked = emptyDatabase();

    await refusal(requireUser(args()));
    await refusal(requireRole(args(), "moderator"));
    await getOptionalUser(readArgs());

    expect(asked).toHaveLength(3);
    for (const condition of asked) {
      const { sql: text } = new PgDialect().sqlToQuery(
        condition as Parameters<PgDialect["sqlToQuery"]>[0],
      );
      expect(text).toMatch(/clerk_id"?\s*=\s*\$1/);
      expect(text).toMatch(/deleted_at"?\s+is null/i);
    }
  });

  it("is refused by requireUser and requireRole, and is nobody for getOptionalUser", async () => {
    emptyDatabase();

    expect((await refusal(requireUser(args()))).init?.status).toBe(403);
    expect((await refusal(requireRole(args(), "user"))).init?.status).toBe(403);
    expect(await getOptionalUser(readArgs())).toBeNull();
  });
});
