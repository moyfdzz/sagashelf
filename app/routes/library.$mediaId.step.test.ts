import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library.$mediaId.step";
import { action, loader } from "./library.$mediaId.step";

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
  headers: Record<string, string> = {},
  id = mediaId,
  body: BodyInit | null = new URLSearchParams({}),
) {
  return action({
    request: new Request(`https://sagashelf.app/library/${id}/step`, {
      method: "POST",
      headers: { Origin: "https://sagashelf.app", ...headers },
      body,
    }),
    params: { mediaId: id },
    context: {},
  } as unknown as Route.ActionArgs);
}

describe("the quick step of a library entry", () => {
  it("adds one to the progress of the person of the session and says so", async () => {
    const result = await send();

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({ progress: 3, status: "in_progress" }),
    );
    expect(result).toMatchObject({
      init: { headers: { "Cache-Control": "private, no-store" } },
      data: { ok: true, progress: 3, status: "in_progress" },
    });
  });

  it("completes the title at the last episode, as the editor does", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, progress: 3 });

    const result = await send();

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({ progress: 4, status: "completed" }),
    );
    expect(result).toMatchObject({
      data: { ok: true, progress: 4, status: "completed" },
    });
  });

  it("answers with data, not an error, when the title is already at its end", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, progress: 4 });

    const result = await send();

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { ok: false, error: "too_high" },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("counts the pages of a book against its total", async () => {
    mocks.getEntry.mockResolvedValue({
      ...stored,
      type: "book",
      progress: 319,
      progressUnit: "pages",
      progressTotal: 320,
    });
    mocks.getSeasonCounts.mockResolvedValue([]);

    await send();

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({ progress: 320, status: "completed" }),
    );
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
    expect(await send({}, "not-an-id")).toMatchObject({
      init: { status: 404 },
    });
    expect(mocks.getEntry).not.toHaveBeenCalled();
  });

  it("sends a form without JavaScript back to the library, and a failed one to the entry", async () => {
    const document = { "Sec-Fetch-Dest": "document" };

    const done = (await send(document)) as Response;
    mocks.getEntry.mockResolvedValue({ ...stored, progress: 4 });
    const failed = (await send(document)) as Response;

    expect(done.status).toBe(303);
    expect(done.headers.get("Location")).toBe("/library");
    expect(failed.status).toBe(303);
    expect(failed.headers.get("Location")).toBe(`/library/${mediaId}`);
  });

  it("refuses a form sent from another site, before looking at the session", async () => {
    const result = await send({ Origin: "https://evil.example" });

    expect(result).toMatchObject({ init: { status: 403 } });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big", async () => {
    const result = await send({ "Content-Length": "5000" });

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
