import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/u.$username";
import { action, headers, loader, meta } from "./u.$username";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  requireUser: vi.fn(),
  getDb: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  findProfile: vi.fn(),
  getSocialCounts: vi.fn(),
  isMuted: vi.fn(),
  getProfileSections: vi.fn(),
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
  muteUser: vi.fn(),
  unmuteUser: vi.fn(),
  blockUser: vi.fn(),
  requestFollow: vi.fn(),
  cancelRequest: vi.fn(),
  hasRequested: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
  requireUser: mocks.requireUser,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/profile-lookup", () => ({
  findProfile: mocks.findProfile,
}));
vi.mock("~server/db/people-lists", () => ({
  getSocialCounts: mocks.getSocialCounts,
}));
vi.mock("~server/db/follows", () => ({
  followUser: mocks.followUser,
  unfollowUser: mocks.unfollowUser,
}));
vi.mock("~server/db/blocks-mutes", () => ({
  isMuted: mocks.isMuted,
  muteUser: mocks.muteUser,
  unmuteUser: mocks.unmuteUser,
  blockUser: mocks.blockUser,
}));
vi.mock("~server/db/follow-requests", () => ({
  requestFollow: mocks.requestFollow,
  cancelRequest: mocks.cancelRequest,
  hasRequested: mocks.hasRequested,
}));
vi.mock("~server/db/profile-library", () => ({
  profileStatuses: ["in_progress", "planned", "completed"],
  getProfileSections: mocks.getProfileSections,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    // Shows the key with what it was given, so a test can see what a title is made of.
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  getLocale: () => mocks.locale,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

const head = (overrides: Record<string, unknown> = {}) => ({
  id: "owner-id",
  username: "ana_reads",
  displayName: "Ana",
  avatarUrl: "https://img.clerk.com/ana",
  bio: "A bio only some may read",
  privacy: "public",
  ...overrides,
});

const emptySections = () => ({
  in_progress: { total: 0, entries: [] },
  planned: { total: 0, entries: [] },
  completed: { total: 0, entries: [] },
});

beforeEach(() => {
  mocks.locale = "es";
  mocks.getOptionalUser.mockReset().mockResolvedValue(session);
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.findProfile.mockReset().mockResolvedValue({
    owner: head(),
    relationship: "stranger",
    view: "full",
  });
  mocks.getSocialCounts
    .mockReset()
    .mockResolvedValue({ followers: 3, following: 2, friends: 1 });
  mocks.isMuted.mockReset().mockResolvedValue(false);
  mocks.getProfileSections.mockReset().mockResolvedValue(emptySections());
  mocks.followUser.mockReset().mockResolvedValue("followed");
  mocks.unfollowUser.mockReset().mockResolvedValue(undefined);
  mocks.muteUser.mockReset().mockResolvedValue(undefined);
  mocks.unmuteUser.mockReset().mockResolvedValue(undefined);
  mocks.blockUser.mockReset().mockResolvedValue(undefined);
  mocks.requestFollow.mockReset().mockResolvedValue("requested");
  mocks.cancelRequest.mockReset().mockResolvedValue(undefined);
  mocks.hasRequested.mockReset().mockResolvedValue(false);
});

const load = (username = "ana_reads", search = "") =>
  loader({
    request: new Request(`http://localhost/u/${username}${search}`),
    params: { username },
    context: {},
  } as unknown as Route.LoaderArgs);

function submit(
  fields: Record<string, string>,
  requestHeaders: Record<string, string> = {},
  username = "ana_reads",
) {
  const request = new Request(`http://localhost/u/${username}`, {
    method: "POST",
    headers: { Origin: "http://localhost", ...requestHeaders },
    body: new URLSearchParams(fields),
  });
  return action({
    request,
    params: { username },
    context: {},
  } as unknown as Route.ActionArgs);
}

type Thrown = { init?: { status?: number; headers?: Record<string, string> } };

describe("the profile page: what it asks and what it answers (SAG-107)", () => {
  describe("loader: who may see it", () => {
    it("asks for the profile as the person of the session, and nobody else", async () => {
      await load();

      expect(mocks.findProfile).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
      );
    });

    it("asks as a visitor when there is no session", async () => {
      mocks.getOptionalUser.mockResolvedValue(null);

      await load();

      expect(mocks.findProfile).toHaveBeenCalledWith(db, null, "ana_reads");
    });

    it.each(["ab", "a".repeat(31), "has space", "a/b/c", "x?y=z", "100%25"])(
      "answers 404 for %j without opening the database",
      async (username) => {
        await expect(load(username)).rejects.toMatchObject({
          init: { status: 404 },
        });
        expect(mocks.getDb).not.toHaveBeenCalled();
      },
    );

    it("answers the same 404, private and not cached, for a profile the person may not see, one that does not exist and a block", async () => {
      mocks.findProfile.mockResolvedValue(null);

      const thrown = (await load().catch((error: unknown) => error)) as Thrown;

      expect(thrown.init?.status).toBe(404);
      expect(thrown.init?.headers?.["Cache-Control"]).toBe("private, no-store");
      expect(mocks.getSocialCounts).not.toHaveBeenCalled();
      expect(mocks.getProfileSections).not.toHaveBeenCalled();
      expect(mocks.isMuted).not.toHaveBeenCalled();
    });
  });

  describe("loader: a locked profile shows only its card", () => {
    beforeEach(() => {
      mocks.findProfile.mockResolvedValue({
        owner: head({ bio: null, privacy: "friends" }),
        relationship: "stranger",
        view: "card",
      });
    });

    it("gives the page the username, the name and the picture, and nothing else of the person", async () => {
      const result = await load();

      expect(result.view).toBe("card");
      expect(result.head).toEqual({
        username: "ana_reads",
        displayName: "Ana",
        avatarUrl: "https://img.clerk.com/ana",
      });
      expect(Object.keys(result).sort()).toEqual([
        "head",
        "notice",
        "title",
        "view",
        "you",
      ]);
    });

    it("does not read the counts or the library, so they cannot leak", async () => {
      const result = await load();

      expect(mocks.getSocialCounts).not.toHaveBeenCalled();
      expect(mocks.getProfileSections).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("bio");
      expect(JSON.stringify(result)).not.toContain("followers");
    });

    it("cannot be followed, only asked for, so the page offers a request", async () => {
      const result = await load();

      expect(result.you).toMatchObject({
        kind: "member",
        canFollow: false,
        canRequest: true,
        requested: false,
      });
    });

    it("says the request was sent when there is one, asking for the own row of the viewer", async () => {
      mocks.hasRequested.mockResolvedValue(true);

      const result = await load();

      expect(result.you).toMatchObject({ canRequest: true, requested: true });
      expect(mocks.hasRequested).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "owner-id",
      );
    });

    it("does not offer a request to somebody who already follows the profile", async () => {
      mocks.findProfile.mockResolvedValue({
        owner: head({ privacy: "friends" }),
        relationship: "follower",
        view: "card",
      });

      const result = await load();

      expect(result.you).toMatchObject({
        following: true,
        canRequest: false,
        requested: false,
      });
      expect(mocks.hasRequested).not.toHaveBeenCalled();
    });

    it("does not offer a request to a visitor, who is sent to sign in", async () => {
      mocks.getOptionalUser.mockResolvedValue(null);

      const result = await load();

      expect(result.you).toMatchObject({ kind: "visitor" });
      expect(mocks.hasRequested).not.toHaveBeenCalled();
    });
  });

  describe("loader: a profile that may be seen in full", () => {
    it("gives the bio, the counts and the sections, with the links of the titles and their covers", async () => {
      mocks.getProfileSections.mockResolvedValue({
        ...emptySections(),
        in_progress: {
          total: 14,
          entries: [
            {
              mediaId,
              title: "Severance",
              type: "series",
              year: 2022,
              imageUrl: null,
              score: 9,
            },
          ],
        },
      });

      const result = await load();

      expect(result.view).toBe("full");
      if (result.view !== "full") return;
      expect(result.bio).toBe("A bio only some may read");
      expect(result.counts).toEqual({ followers: 3, following: 2, friends: 1 });
      expect(result.sections.map((section) => section.status)).toEqual([
        "in_progress",
        "planned",
        "completed",
      ]);
      expect(result.sections[0]).toMatchObject({
        total: 14,
        entries: [
          {
            href: `/media/series/severance-${mediaId}`,
            title: "Severance",
            year: 2022,
            score: 9,
            poster: null,
          },
        ],
      });
      // Never the notes, the visibility or the id of the library entry.
      expect(JSON.stringify(result)).not.toContain("notes");
      expect(JSON.stringify(result)).not.toContain("visibility");
    });

    it("asks for the library with the level of the profile, the relationship and the language of the page", async () => {
      mocks.locale = "en";
      mocks.findProfile.mockResolvedValue({
        owner: head({ privacy: "friends" }),
        relationship: "friend",
        view: "full",
      });

      await load();

      expect(mocks.getProfileSections).toHaveBeenCalledWith(
        db,
        "owner-id",
        "friends",
        "friend",
        "en",
      );
    });

    it("drops a picture that is not an HTTPS address", async () => {
      mocks.findProfile.mockResolvedValue({
        owner: head({ avatarUrl: "javascript:alert(1)" }),
        relationship: "stranger",
        view: "full",
      });

      expect((await load()).head.avatarUrl).toBeNull();
    });

    it("names the page after the person, and uses the username when there is no name", async () => {
      mocks.findProfile.mockResolvedValue({
        owner: head({ displayName: null }),
        relationship: "stranger",
        view: "full",
      });

      expect((await load()).title).toContain("ana_reads");
    });
  });

  describe("loader: what the viewer can do", () => {
    it("tells the owner to edit, and offers no follow, mute or block", async () => {
      mocks.findProfile.mockResolvedValue({
        owner: head(),
        relationship: "owner",
        view: "full",
      });

      const result = await load();

      expect(result.you).toEqual({ kind: "owner" });
      expect(mocks.isMuted).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in, and does not look for a mute", async () => {
      mocks.getOptionalUser.mockResolvedValue(null);
      mocks.findProfile.mockResolvedValue({
        owner: head(),
        relationship: "signed_out",
        view: "full",
      });

      const result = await load();

      expect(result.you).toMatchObject({ kind: "visitor" });
      expect((result.you as { signInPath: string }).signInPath).toContain(
        "sign-in",
      );
      expect(mocks.isMuted).not.toHaveBeenCalled();
    });

    it.each([
      ["stranger", false, true],
      ["follower", true, true],
      ["friend", true, true],
    ])("says following is %s for a %s", async (relationship, following) => {
      mocks.findProfile.mockResolvedValue({
        owner: head(),
        relationship,
        view: "full",
      });

      expect((await load()).you).toMatchObject({ kind: "member", following });
    });

    describe("the confirmation to unfollow a Private profile (SAG-124)", () => {
      const as = (relationship: string, privacy: string) =>
        mocks.findProfile.mockResolvedValue({
          owner: head({ privacy }),
          relationship,
          view: "full",
        });

      it.each(["friend", "follower"])(
        "asks first, and shows the warning only with ?confirm=unfollow, for a %s of a Private profile",
        async (relationship) => {
          as(relationship, "friends");

          expect((await load()).you).toMatchObject({
            unfollowAsks: true,
            confirmUnfollow: false,
          });
          expect(
            (await load("ana_reads", "?confirm=unfollow")).you,
          ).toMatchObject({ unfollowAsks: true, confirmUnfollow: true });
          expect((await load("ana_reads", "?confirm=other")).you).toMatchObject(
            {
              confirmUnfollow: false,
            },
          );
        },
      );

      it("does not ask for a Public profile, and ignores the parameter", async () => {
        as("follower", "public");

        expect(
          (await load("ana_reads", "?confirm=unfollow")).you,
        ).toMatchObject({
          unfollowAsks: false,
          confirmUnfollow: false,
        });
      });

      it("does not show the warning to somebody who does not follow", async () => {
        as("stranger", "friends");

        expect(
          (await load("ana_reads", "?confirm=unfollow")).you,
        ).toMatchObject({
          unfollowAsks: false,
          confirmUnfollow: false,
        });
      });
    });

    it("lets a public profile be followed and not a friends-only one, even for a follower", async () => {
      mocks.findProfile.mockResolvedValue({
        owner: head({ privacy: "friends" }),
        relationship: "friend",
        view: "full",
      });

      expect((await load()).you).toMatchObject({
        canFollow: false,
        canRequest: false,
      });
      expect(mocks.hasRequested).not.toHaveBeenCalled();
    });

    it("never offers a request for a public profile, which is followed directly", async () => {
      const result = await load();

      expect(result.you).toMatchObject({ canFollow: true, canRequest: false });
      expect(mocks.hasRequested).not.toHaveBeenCalled();
    });

    it("says whether the viewer muted the person, asking for the viewer's own row", async () => {
      mocks.isMuted.mockResolvedValue(true);

      const result = await load();

      expect(result.you).toMatchObject({ muted: true });
      expect(mocks.isMuted).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "owner-id",
      );
    });
  });

  describe("loader: the notice after a button", () => {
    it.each([
      "followed",
      "unfollowed",
      "requested",
      "request_cancelled",
      "muted",
      "unmuted",
      "too_many",
      "unavailable",
      "invalid_request",
    ])("passes the word %s on", async (word) => {
      expect((await load("ana_reads", `?notice=${word}`)).notice).toBe(word);
    });

    it.each(["", "<script>", "followed%20", "FOLLOWED", "hacked"])(
      "ignores %j, so the address cannot write anything on the page",
      async (word) => {
        expect(
          (await load("ana_reads", `?notice=${encodeURIComponent(word)}`))
            .notice,
        ).toBeNull();
      },
    );
  });

  it("is private, never cached by a shared cache, and not indexed", () => {
    const merged = headers({
      loaderHeaders: new Headers({ "Cache-Control": "public, max-age=60" }),
      actionHeaders: new Headers(),
    } as unknown as Route.HeadersArgs);

    expect(merged.get("Cache-Control")).toBe("private, no-store");
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});

describe("the profile page: the buttons (POST)", () => {
  const redirectOf = (result: unknown) => {
    const response = result as Response;
    return { status: response.status, to: response.headers.get("Location") };
  };

  describe("what stops a request before it does anything", () => {
    it("refuses a body that is too big, without reading who sent it", async () => {
      const result = (await submit(
        { intent: "block" },
        { "Content-Length": String(5 * 1024) },
      )) as Thrown;

      expect(result.init?.status).toBe(413);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.blockUser).not.toHaveBeenCalled();
    });

    it("refuses a form sent from another site", async () => {
      const result = (await submit(
        { intent: "block" },
        { Origin: "https://evil.example" },
      )) as Thrown;

      expect(result.init?.status).toBe(403);
      expect(mocks.blockUser).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in and does nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(submit({ intent: "follow" })).rejects.toBe(redirect);
      expect(mocks.followUser).not.toHaveBeenCalled();
    });

    it("is limited per person, and a limited request does nothing", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit({ intent: "follow" })) as Response;

      expect(result.status).toBe(429);
      expect(mocks.limit).toHaveBeenCalledWith({
        key: expect.stringContaining("social:user-from-session"),
      });
      expect(mocks.followUser).not.toHaveBeenCalled();
      expect(mocks.requestFollow).not.toHaveBeenCalled();
    });

    it.each([
      ["no intent", {}],
      ["an intent that does not exist", { intent: "delete" }],
      ["a field the form does not have", { intent: "follow", userId: "other" }],
      ["an id of a person in the form", { intent: "block", username: "x" }],
    ])(
      "goes back to the profile with a notice for %s",
      async (_name, fields) => {
        const result = redirectOf(
          await submit(fields as Record<string, string>),
        );

        expect(result).toEqual({
          status: 303,
          to: "/u/ana_reads?notice=invalid_request",
        });
        expect(mocks.followUser).not.toHaveBeenCalled();
        expect(mocks.blockUser).not.toHaveBeenCalled();
      },
    );

    it.each(["ab", "a/b", "has space"])(
      "answers 404 for the address %j",
      async (username) => {
        await expect(
          submit({ intent: "follow" }, {}, username),
        ).rejects.toMatchObject({ init: { status: 404 } });
        expect(mocks.followUser).not.toHaveBeenCalled();
      },
    );
  });

  describe("what each button does", () => {
    it("follows the person of the address, as the person of the session", async () => {
      const result = redirectOf(await submit({ intent: "follow" }));

      expect(mocks.followUser).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
      );
      expect(result).toEqual({
        status: 303,
        to: "/u/ana_reads?notice=followed",
      });
    });

    it.each(["unavailable", "too_many"])(
      "says %s without saying why",
      async (answer) => {
        mocks.followUser.mockResolvedValue(answer);

        expect(redirectOf(await submit({ intent: "follow" }))).toEqual({
          status: 303,
          to: `/u/ana_reads?notice=${answer}`,
        });
      },
    );

    it("asks to follow the person of the address, as the person of the session", async () => {
      const result = redirectOf(await submit({ intent: "request" }));

      expect(mocks.requestFollow).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
      );
      expect(mocks.followUser).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 303,
        to: "/u/ana_reads?notice=requested",
      });
    });

    it.each(["unavailable", "too_many"])(
      "says %s to a request without saying why",
      async (answer) => {
        mocks.requestFollow.mockResolvedValue(answer);

        expect(redirectOf(await submit({ intent: "request" }))).toEqual({
          status: 303,
          to: `/u/ana_reads?notice=${answer}`,
        });
      },
    );

    it("takes back a request, as the person of the session", async () => {
      const result = redirectOf(await submit({ intent: "cancel_request" }));

      expect(mocks.cancelRequest).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
      );
      expect(result).toEqual({
        status: 303,
        to: "/u/ana_reads?notice=request_cancelled",
      });
    });

    it("unfollows, mutes and unmutes, each with the person of the session", async () => {
      expect(redirectOf(await submit({ intent: "unfollow" })).to).toBe(
        "/u/ana_reads?notice=unfollowed",
      );
      expect(redirectOf(await submit({ intent: "mute" })).to).toBe(
        "/u/ana_reads?notice=muted",
      );
      expect(redirectOf(await submit({ intent: "unmute" })).to).toBe(
        "/u/ana_reads?notice=unmuted",
      );
      for (const fn of [mocks.unfollowUser, mocks.muteUser, mocks.unmuteUser]) {
        expect(fn).toHaveBeenCalledWith(db, "user-from-session", "ana_reads");
      }
    });

    it("blocks, and goes to the page where it is undone, since the profile is gone for this person now", async () => {
      const result = redirectOf(await submit({ intent: "block" }));

      expect(mocks.blockUser).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
      );
      expect(result).toEqual({ status: 303, to: "/settings/people" });
    });

    it("keeps an odd username safe in the address it goes back to", async () => {
      const result = redirectOf(
        await submit({ intent: "follow" }, {}, "a_b-c.d"),
      );

      expect(result.to).toBe("/u/a_b-c.d?notice=followed");
    });
  });
});
