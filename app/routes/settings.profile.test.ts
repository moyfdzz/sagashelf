import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.profile";
import { action, headers, loader } from "./settings.profile";
import { localeCookie } from "~/middleware/i18next";
import { bioMaxLength } from "~server/account/profile-schema";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: () => ({ publishableKey: "pk_test_for_the_tests" }),
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
// Clerk adds its own state to what the loader returns; here it only passes the data through.
vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (
    args: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ ...(handler(args) as object), __clerk_ssr_state: "state" }),
}));
vi.mock("~server/db/profile", () => ({
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
}));
vi.mock("~/middleware/i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/middleware/i18next")>()),
  getInstance: () => ({ t: (key: string) => key }),
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const stored = {
  username: "ana_reads",
  displayName: "Ana",
  avatarUrl: null,
  bio: null,
  locale: "es",
  privacy: "public",
};

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.getProfile.mockReset().mockResolvedValue(stored);
  mocks.updateProfile.mockReset().mockResolvedValue(stored);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const signInRedirect = new Response(null, {
  status: 302,
  headers: { Location: "/sign-in?redirectTo=%2Fsettings%2Fprofile" },
});

function submit(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const request = new Request("http://localhost/settings/profile", {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

/** `data()` answers are objects with the body in `data` and the headers in `init`. */
type Answer = {
  data: Record<string, unknown>;
  init?: { status?: number; headers?: HeadersInit };
};
const answer = (value: unknown) => value as Answer;
const headersOf = (value: unknown) => new Headers(answer(value).init?.headers);

describe("GET /settings/profile", () => {
  it("sends a visitor without a session to sign in, and opens nothing", async () => {
    mocks.requireUser.mockRejectedValue(signInRedirect);

    await expect(
      loader({
        request: new Request("http://localhost/settings/profile"),
        context: {},
      } as unknown as Route.LoaderArgs),
    ).rejects.toBe(signInRedirect);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("shows the profile of the person in the session, with what Clerk's script needs", async () => {
    const result = await loader({
      request: new Request("http://localhost/settings/profile"),
      context: {},
    } as unknown as Route.LoaderArgs);

    expect(mocks.getProfile).toHaveBeenCalledWith(db, "user-from-session");
    expect(result).toMatchObject({
      profile: stored,
      title: "settings.profile.title",
      publishableKey: "pk_test_for_the_tests",
      __clerk_ssr_state: "state",
    });
  });

  it("does not hand Clerk's state to a visitor who is not allowed in", async () => {
    mocks.getProfile.mockResolvedValue(null);

    await expect(
      loader({
        request: new Request("http://localhost/settings/profile"),
        context: {},
      } as unknown as Route.LoaderArgs),
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("refuses an account that has no profile row", async () => {
    mocks.getProfile.mockResolvedValue(null);

    await expect(
      loader({
        request: new Request("http://localhost/settings/profile"),
        context: {},
      } as unknown as Route.LoaderArgs),
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});

describe("POST /settings/profile: who is changed", () => {
  it("changes the person in the session, with the values that were sent", async () => {
    const result = await submit({
      displayName: "  Ana   María ",
      bio: "Hola",
      privacy: "friends",
    });

    expect(mocks.updateProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateProfile).toHaveBeenCalledWith(db, "user-from-session", {
      displayName: "Ana María",
      bio: "Hola",
      privacy: "friends",
    });
    expect(answer(result).data).toMatchObject({ ok: true, profile: stored });
    expect(headersOf(result).get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a form that names another user, a role or any other field", async () => {
    for (const field of [
      "userId",
      "id",
      "role",
      "clerkId",
      "email",
      "username",
    ]) {
      mocks.updateProfile.mockClear();

      const result = await submit({ displayName: "Ana", [field]: "other" });

      expect(answer(result).init?.status).toBe(400);
      expect(answer(result).data).toMatchObject({
        ok: false,
        errors: { form: "generic" },
      });
      expect(mocks.updateProfile).not.toHaveBeenCalled();
    }
  });

  it("sends a visitor without a session to sign in, and writes nothing", async () => {
    mocks.requireUser.mockRejectedValue(signInRedirect);

    await expect(submit({ displayName: "Ana" })).rejects.toBe(signInRedirect);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("refuses a deleted account", async () => {
    mocks.updateProfile.mockResolvedValue(null);

    await expect(submit({ displayName: "Ana" })).rejects.toMatchObject({
      init: { status: 403 },
    });
  });
});

describe("POST /settings/profile: language", () => {
  it("saves the new language in the cookie, so the page switches at once", async () => {
    mocks.updateProfile.mockResolvedValue({ ...stored, locale: "en" });

    const result = await submit({ locale: "en" });

    const cookie = headersOf(result).get("Set-Cookie") ?? "";
    expect(await localeCookie.parse(cookie)).toBe("en");
  });

  it("does not touch the cookie when the language was not sent", async () => {
    const result = await submit({ displayName: "Ana" });

    expect(headersOf(result).get("Set-Cookie")).toBeNull();
  });
});

describe("POST /settings/profile: values that are refused", () => {
  it("answers 400 with one code per field and writes nothing", async () => {
    const result = await submit({
      bio: "x".repeat(bioMaxLength + 1),
      displayName: "a".repeat(51),
      locale: "fr",
      privacy: "everyone",
    });

    expect(answer(result).init?.status).toBe(400);
    expect(answer(result).data).toEqual({
      ok: false,
      errors: {
        bio: "bio_too_long",
        displayName: "display_name_too_long",
        locale: "invalid_locale",
        privacy: "invalid_privacy",
      },
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("does not send back what was typed", async () => {
    const secret = "my-private-note-".repeat(40);

    const result = await submit({ bio: secret });

    expect(JSON.stringify(answer(result).data)).not.toContain(
      "my-private-note",
    );
  });
});

describe("POST /settings/profile: the request itself", () => {
  it("refuses a request that comes from another site, before anything else", async () => {
    const result = await submit(
      { displayName: "Ana" },
      { Origin: "https://evil.example" },
    );

    expect(answer(result).init?.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("refuses a body that is too large before reading it", async () => {
    const result = await submit(
      { displayName: "Ana" },
      { "Content-Length": "1000000" },
    );

    expect(answer(result).init?.status).toBe(413);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("answers 429 when the person is over the limit, counted by their id", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = (await submit(
      { displayName: "Ana" },
      { "CF-Connecting-IP": "1.2.3.4" },
    )) as Response;

    expect(result.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith({
      key: "profile:user-from-session:1.2.3.4",
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});

describe("headers of the settings page", () => {
  const pageHeaders = (loader: HeadersInit = {}, action: HeadersInit = {}) =>
    headers({
      loaderHeaders: new Headers(loader),
      actionHeaders: new Headers(action),
      parentHeaders: new Headers(),
      errorHeaders: undefined,
    } as unknown as Route.HeadersArgs) as Headers;

  it("is never kept by a shared cache, for the page and for what it answers", () => {
    expect(pageHeaders().get("Cache-Control")).toBe("private, no-store");
    expect(
      pageHeaders({ "Cache-Control": "public, max-age=3600" }).get(
        "Cache-Control",
      ),
    ).toBe("private, no-store");
  });

  it("keeps the language cookie that a saved change sets", () => {
    const merged = pageHeaders({}, { "Set-Cookie": "locale=en; Path=/" });

    expect(merged.get("Set-Cookie")).toContain("locale=en");
  });
});
