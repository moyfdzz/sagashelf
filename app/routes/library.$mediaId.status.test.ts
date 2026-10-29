import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library.$mediaId.status";
import { action, loader } from "./library.$mediaId.status";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getEntry: vi.fn(),
  getSeasonCounts: vi.fn(),
  saveEntry: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/library", () => ({
  getEntry: mocks.getEntry,
  getSeasonCounts: mocks.getSeasonCounts,
  saveEntry: mocks.saveEntry,
  totalEpisodes: (seasons: { episodes: number }[]) =>
    seasons.reduce((sum, season) => sum + season.episodes, 0),
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const stored = {
  mediaId,
  title: "Ataque a los Titanes",
  type: "anime",
  status: "in_progress",
  progress: 2,
  progressUnit: null,
  progressTotal: null,
  score: 8,
  startedAt: "2026-01-02",
  finishedAt: null,
  notes: "nota",
  visibility: "private",
};

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getEntry.mockReset().mockResolvedValue(stored);
  mocks.getSeasonCounts.mockReset().mockResolvedValue([
    { number: 1, episodes: 2 },
    { number: 2, episodes: 2 },
  ]);
  mocks.saveEntry.mockReset().mockResolvedValue(true);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

function send(
  fields: Record<string, string> = { status: "paused" },
  headers: Record<string, string> = {},
  id = mediaId,
) {
  return action({
    request: new Request(`https://sagashelf.app/library/${id}/status`, {
      method: "POST",
      headers: { Origin: "https://sagashelf.app", ...headers },
      body: new URLSearchParams(fields),
    }),
    params: { mediaId: id },
    context: {},
  } as unknown as Route.ActionArgs);
}

describe("changing the status of a library entry from the title page", () => {
  it("saves the new status for the person of the session and says so", async () => {
    const result = await send({ status: "paused" });

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({ status: "paused", progress: 2 }),
    );
    expect(result).toMatchObject({
      init: { headers: { "Cache-Control": "private, no-store" } },
      data: { ok: true, status: "paused", progress: 2 },
    });
  });

  it("gives a completed title all its episodes, as the editor does", async () => {
    const result = await send({ status: "completed" });

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({ status: "completed", progress: 4 }),
    );
    expect(result).toMatchObject({
      data: { ok: true, status: "completed", progress: 4 },
    });
  });

  it("answers in progress when planned is asked for a title with progress", async () => {
    const result = await send({ status: "planned" });

    expect(result).toMatchObject({
      data: { ok: true, status: "in_progress", progress: 2 },
    });
  });

  it("answers 400 as data for a status that does not exist, or a field that is not the form", async () => {
    for (const fields of [
      { status: "evil" },
      { status: "" },
      {},
      { status: "paused", extra: "1" },
    ] as Record<string, string>[]) {
      expect(await send(fields)).toMatchObject({
        init: { status: 400 },
        data: { ok: false, error: "invalid_request" },
      });
    }
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("answers 404 as data when the person has no such entry, which is also what somebody else's looks like", async () => {
    mocks.getEntry.mockResolvedValue(null);

    expect(await send()).toMatchObject({
      init: { status: 404 },
      data: { ok: false, error: "invalid_request" },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("answers 404 as data when the entry disappears between reading and writing", async () => {
    mocks.saveEntry.mockResolvedValue(false);

    expect(await send()).toMatchObject({ init: { status: 404 } });
  });

  it("answers 404 for an id that is not an id, without asking the database", async () => {
    expect(await send({ status: "paused" }, {}, "not-an-id")).toMatchObject({
      init: { status: 404 },
    });
    expect(mocks.getEntry).not.toHaveBeenCalled();
  });

  it("sends a form without JavaScript back to the title page it came from", async () => {
    const response = (await send(
      { status: "paused" },
      {
        "Sec-Fetch-Dest": "document",
        Referer: "https://sagashelf.app/media/series/the-pitt-01a17ed1",
      },
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/media/series/the-pitt-01a17ed1",
    );
  });

  it("sends a form without JavaScript to the entry when it does not know where it came from", async () => {
    for (const referer of [
      undefined,
      "https://evil.example/media/series/x-1",
    ]) {
      const response = (await send(
        { status: "paused" },
        {
          "Sec-Fetch-Dest": "document",
          ...(referer ? { Referer: referer } : {}),
        },
      )) as Response;

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`/library/${mediaId}`);
    }
  });

  it("refuses a form sent from another site, before looking at the session", async () => {
    const result = await send(undefined, { Origin: "https://evil.example" });

    expect(result).toMatchObject({ init: { status: 403 } });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big", async () => {
    const result = await send(undefined, { "Content-Length": "5000" });

    expect(result).toMatchObject({ init: { status: 413 } });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("is rate limited per person, with the same limiter as the editor", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = (await send()) as Response;

    expect(result.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith({
      key: expect.stringContaining("library:user-1"),
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("needs a session: the person never comes from the form", async () => {
    mocks.requireUser.mockRejectedValue(new Response(null, { status: 302 }));

    await expect(send()).rejects.toBeInstanceOf(Response);
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("is only for a POST", () => {
    expect(() => loader()).toThrowError();
  });
});
