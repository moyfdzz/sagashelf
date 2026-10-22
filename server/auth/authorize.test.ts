import { describe, expect, it, vi } from "vitest";

import { authorize, type AuthDeps, type SessionUser } from "./authorize";

const ana: SessionUser = { id: "u1", clerkId: "user_ana", role: "user" };
const boss: SessionUser = { id: "u2", clerkId: "user_boss", role: "admin" };

function deps(users: SessionUser[], google = true): AuthDeps {
  return {
    findUser: vi.fn(
      async (clerkId: string) =>
        users.find((u) => u.clerkId === clerkId) ?? null,
    ),
    hasVerifiedGoogle: vi.fn(async () => google),
  };
}

describe("authorize", () => {
  it("rejects a caller with no session without touching the database", async () => {
    const d = deps([ana]);
    expect(await authorize(null, d)).toEqual({
      ok: false,
      reason: "signed_out",
    });
    expect(d.findUser).not.toHaveBeenCalled();
  });

  it("rejects a session with no local account", async () => {
    expect(await authorize("user_ghost", deps([ana]))).toEqual({
      ok: false,
      reason: "no_account",
    });
  });

  it("accepts a signed-in user and returns the local row", async () => {
    expect(await authorize("user_ana", deps([ana]))).toEqual({
      ok: true,
      user: ana,
    });
  });

  it("denies a regular user a role they do not have", async () => {
    expect(await authorize("user_ana", deps([ana]), "admin")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await authorize("user_ana", deps([ana]), "moderator")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("lets an admin in only with a verified Google login", async () => {
    expect(await authorize("user_boss", deps([boss]), "admin")).toEqual({
      ok: true,
      user: boss,
    });
    expect(await authorize("user_boss", deps([boss], false), "admin")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("does not ask Clerk about Google for non-admins", async () => {
    const d = deps([ana]);
    await authorize("user_ana", d, "admin");
    expect(d.hasVerifiedGoogle).not.toHaveBeenCalled();
  });

  it("accepts a moderator for the moderator role", async () => {
    const mod: SessionUser = {
      id: "u3",
      clerkId: "user_mod",
      role: "moderator",
    };
    expect(await authorize("user_mod", deps([mod]), "moderator")).toEqual({
      ok: true,
      user: mod,
    });
  });
});
