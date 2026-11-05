import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who each route may be read by (SAG-29, part 2). One table, one row per route with a `loader`,
 * and the kind of access it has. It is the read side of `write-actions.test.ts`: a new route that
 * reads cannot be added without saying who may see it, and a route that says "a signed-in person"
 * is shown to stop at the session before it opens the database.
 *
 * What a person may see of another person is not decided here. It is decided in `canView`, and
 * tested where it lives: every level and every relationship on the real database
 * (`db/social-profile.integration.test.ts`), and what each profile route asks of it
 * (`u.$username.test.ts`, `u.$username.$kind.test.ts`). There is no administrator exception in
 * `canView`: an administrator who reads a profile is a stranger like anyone else.
 *
 * Only the edges are mocked: who is signed in and the database. The loaders run for real up to the
 * point where they would read something.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireRole: vi.fn(),
  getOptionalUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({
  requireUser: mocks.requireUser,
  requireRole: mocks.requireRole,
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: () => null,
}));

/**
 * - `session`: the page of a signed-in person, about their own things. No session, no answer.
 * - `admin`: needs the role `admin` (and a verified Google login, which `requireRole` asks).
 * - `visitor`: a public page that shows a little more to a person who is signed in.
 * - `public`: the same for everybody, and it never asks who is reading.
 * - `post-only`: a `GET` is answered 405 (or sent home), without looking at the session.
 */
type Access = "session" | "admin" | "visitor" | "public" | "post-only";

type Row = {
  file: string;
  path: string;
  params: Record<string, string>;
  access: Access;
};

const uuid = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const row = (
  file: string,
  access: Access,
  path: string,
  params: Record<string, string> = {},
): Row => ({ file, access, path, params });

const rows: Row[] = [
  row("library.tsx", "session", "/library"),
  row("library.$mediaId.tsx", "session", `/library/${uuid}`, { mediaId: uuid }),
  row("notifications.tsx", "session", "/notifications"),
  row("recommendations.tsx", "session", "/recommendations"),
  row("stats.tsx", "session", "/stats"),
  row("settings.import.tsx", "session", "/settings/import"),
  row("settings.notifications.tsx", "session", "/settings/notifications"),
  row("settings.people.tsx", "session", "/settings/people"),
  row("settings.profile.tsx", "session", "/settings/profile"),

  row("admin.sagas.tsx", "admin", "/admin/sagas"),
  row("admin.sagas.$id.tsx", "admin", `/admin/sagas/${uuid}`, { id: uuid }),

  row("u.$username.tsx", "visitor", "/u/ana", { username: "ana" }),
  row("u.$username.$kind.tsx", "visitor", "/u/ana/followers", {
    username: "ana",
    kind: "followers",
  }),
  row("media.$type.$slug.tsx", "visitor", "/media/movie/some-title", {
    type: "movie",
    slug: "some-title",
  }),
  row("sagas.$slug.tsx", "visitor", "/sagas/some-saga", { slug: "some-saga" }),
  row("search.tsx", "visitor", "/search?q=naruto"),

  row("home.tsx", "public", "/"),
  row("community.tsx", "public", "/community"),
  row("credits.tsx", "public", "/credits"),
  row("privacy.tsx", "public", "/privacy"),
  row("terms.tsx", "public", "/terms"),
  row("sign-in.tsx", "public", "/sign-in"),
  row("sign-up.tsx", "public", "/sign-up"),
  row("sign-out.tsx", "public", "/sign-out"),
  row("not-found.tsx", "public", "/nowhere"),
  row("api.health.ts", "public", "/api/health"),
  row("img.ts", "public", "/img/tmdb/w185/poster.jpg", {
    provider: "tmdb",
    size: "w185",
    file: "poster.jpg",
  }),
  row("media.open.ts", "visitor", "/media/open?provider=tmdb&id=1"),

  row("api.locale.ts", "post-only", "/api/locale"),
  row("library.add.ts", "post-only", "/library/add"),
  row("library.add-external.ts", "post-only", "/library/add-external"),
  row("library.$mediaId.status.ts", "post-only", `/library/${uuid}/status`, {
    mediaId: uuid,
  }),
  row("library.$mediaId.step.ts", "post-only", `/library/${uuid}/step`, {
    mediaId: uuid,
  }),
  row("settings.delete.ts", "post-only", "/settings/delete"),
  row("settings.export.ts", "post-only", "/settings/export"),
  row("settings.username.ts", "post-only", "/settings/username"),
  row("webhooks.clerk.ts", "post-only", "/webhooks/clerk"),
];

const origin = "https://sagashelf.app";

// Every route file, loaded only when a test asks for it.
const routeModules = import.meta.glob<{
  loader: (args: unknown) => unknown;
}>(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"]);

/** Runs the loader of a route and says what came out: a value, or the thing it threw. */
async function run(r: Row) {
  const load = routeModules[`./${r.file}`];
  if (!load) throw new Error(`no route file ${r.file}`);
  const module = await load();
  try {
    return {
      threw: false as const,
      value: await module.loader({
        request: new Request(`${origin}${r.path}`),
        params: r.params,
        context: {},
      }),
    };
  } catch (error) {
    return { threw: true as const, value: error };
  }
}

const statusOf = (value: unknown): number | undefined => {
  if (value instanceof Response) return value.status;
  return (value as { init?: { status?: number } } | null)?.init?.status;
};

const signedOut = new Error("signed out");

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.requireRole.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  mocks.getDb.mockReset().mockRejectedValue(new Error("no database here"));
});

describe("every route with a loader is in the table", () => {
  const dir = __dirname;
  const withLoader = readdirSync(dir).filter(
    (name) =>
      /\.tsx?$/.test(name) &&
      !/\.test\.tsx?$/.test(name) &&
      /export (async )?function loader\b/.test(
        readFileSync(join(dir, name), "utf8"),
      ),
  );

  it("finds the routes that read", () => {
    expect(withLoader.length).toBeGreaterThan(20);
  });

  it("has a row for each of them, and no row for a file that is gone", () => {
    expect(rows.map((r) => r.file).sort()).toEqual([...withLoader].sort());
  });
});

describe.each(rows.filter((r) => r.access === "session"))(
  "$file (a signed-in person)",
  (r) => {
    it("stops at the session, before it opens the database", async () => {
      mocks.requireUser.mockRejectedValue(signedOut);

      const result = await run(r);

      expect(result.threw).toBe(true);
      expect(result.value).toBe(signedOut);
      expect(mocks.requireUser).toHaveBeenCalledTimes(1);
      expect(mocks.getDb).not.toHaveBeenCalled();
    });

    it("does not ask for an administrator, and does not treat a visitor as one", async () => {
      await run(r);

      expect(mocks.requireRole).not.toHaveBeenCalled();
      expect(mocks.getOptionalUser).not.toHaveBeenCalled();
    });
  },
);

describe.each(rows.filter((r) => r.access === "admin"))(
  "$file (an administrator)",
  (r) => {
    it("asks for the role admin, and stops there for anybody else, before the database", async () => {
      mocks.requireRole.mockRejectedValue(signedOut);

      const result = await run(r);

      expect(result.value).toBe(signedOut);
      expect(mocks.requireRole).toHaveBeenCalledTimes(1);
      expect(mocks.requireRole.mock.calls[0]?.[1]).toBe("admin");
      expect(mocks.getDb).not.toHaveBeenCalled();
    });

    it("is not opened by a signed-in person who is not an administrator", async () => {
      mocks.requireUser.mockResolvedValue({ id: "user-1", role: "user" });
      mocks.requireRole.mockRejectedValue(signedOut);

      const result = await run(r);

      expect(result.threw).toBe(true);
      expect(mocks.requireUser).not.toHaveBeenCalled();
    });
  },
);

describe.each(rows.filter((r) => r.access === "visitor"))(
  "$file (a page for visitors)",
  (r) => {
    it("never demands a session or a role: a visitor is let in", async () => {
      await run(r);

      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.requireRole).not.toHaveBeenCalled();
    });
  },
);

describe.each(rows.filter((r) => r.access === "public"))(
  "$file (the same for everybody)",
  (r) => {
    it("does not ask who is reading", async () => {
      await run(r);

      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.requireRole).not.toHaveBeenCalled();
      expect(mocks.getOptionalUser).not.toHaveBeenCalled();
    });
  },
);

describe.each(rows.filter((r) => r.access === "post-only"))(
  "$file (a form target)",
  (r) => {
    it("answers a GET with 405 or sends it home, and reads nothing", async () => {
      const result = await run(r);

      if (r.file === "api.locale.ts") {
        expect(statusOf(result.value)).toBe(302);
      } else {
        expect(statusOf(result.value)).toBe(405);
      }
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled();
    });
  },
);

/**
 * What a route file calls to know who is reading. A page for visitors reads its public data first
 * and asks who is looking after that, so the runtime checks above cannot reach it with a database
 * that fails: this reads the code instead. A file with an `action` may also call `requireUser`
 * for its write, which `write-actions.test.ts` covers.
 */
describe("the guard each route file calls", () => {
  const guards = ["requireUser", "requireRole", "getOptionalUser"] as const;
  const calledBy = (file: string) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    return {
      called: guards.filter((name) => source.includes(`${name}(`)),
      hasAction: /export (async )?function action\b/.test(source),
    };
  };

  it.each(rows.filter((r) => r.access === "session"))(
    "$file calls requireUser and nothing that lets a visitor in",
    (r) => {
      const { called } = calledBy(r.file);
      expect(called).toContain("requireUser");
      expect(called).not.toContain("getOptionalUser");
      expect(called).not.toContain("requireRole");
    },
  );

  it.each(rows.filter((r) => r.access === "admin"))(
    "$file calls requireRole and nothing weaker",
    (r) => {
      const { called } = calledBy(r.file);
      expect(called).toContain("requireRole");
      expect(called).not.toContain("getOptionalUser");
      expect(called).not.toContain("requireUser");
    },
  );

  it.each(rows.filter((r) => r.access === "visitor"))(
    "$file asks who is reading, and does not turn a visitor away",
    (r) => {
      const { called, hasAction } = calledBy(r.file);
      expect(called).toContain("getOptionalUser");
      expect(called).not.toContain("requireRole");
      if (!hasAction) expect(called).not.toContain("requireUser");
    },
  );

  it.each(rows.filter((r) => r.access === "public"))(
    "$file never asks who is reading",
    (r) => {
      expect(calledBy(r.file).called).toEqual([]);
    },
  );
});
