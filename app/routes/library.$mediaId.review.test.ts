import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library.$mediaId.review";
import { action, loader } from "./library.$mediaId.review";

// SAG-22, ADR-053: the page that writes, edits and deletes the review of one title.

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getEntry: vi.fn(),
  saveEntry: vi.fn(),
  getOwnReview: vi.fn(),
  getReviewerFacts: vi.fn(),
  saveReview: vi.fn(),
  deleteReview: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/library", () => ({
  getEntry: mocks.getEntry,
  saveEntry: mocks.saveEntry,
}));
vi.mock("~server/db/reviews", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOwnReview: mocks.getOwnReview,
  getReviewerFacts: mocks.getReviewerFacts,
  saveReview: mocks.saveReview,
  deleteReview: mocks.deleteReview,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getWriteLimiter: () => ({ limit: mocks.limit }),
  getClerkKeys: () => ({
    publishableKey: "publishable-key-for-tests",
    secretKey: "secret-for-tests",
  }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => "es",
}));

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const titlePage = `/media/anime/frieren-${mediaId}#reviews`;

const entry = {
  mediaId,
  title: "Frieren",
  type: "anime",
  status: "completed",
  progress: 28,
  progressUnit: null,
  progressTotal: null,
  score: 8,
  startedAt: null,
  finishedAt: null,
  notes: null,
  visibility: "public",
  version: "2026-11-20 10:00:00.123456",
};

const body = "Una reseña que dice algo de la historia. ".repeat(14).trim();

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getEntry.mockReset().mockResolvedValue(entry);
  mocks.saveEntry.mockReset().mockResolvedValue("saved");
  mocks.getOwnReview.mockReset().mockResolvedValue(null);
  mocks.getReviewerFacts
    .mockReset()
    .mockResolvedValue({ privacy: "friends", held: false });
  mocks.saveReview.mockReset().mockResolvedValue("created");
  mocks.deleteReview.mockReset().mockResolvedValue(true);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const load = () =>
  loader({
    request: new Request(`https://sagashelf.app/library/${mediaId}/review`),
    params: { mediaId },
    context: {},
  } as unknown as Route.LoaderArgs);

const send = (fields: Record<string, string>) =>
  action({
    request: new Request(`https://sagashelf.app/library/${mediaId}/review`, {
      method: "POST",
      headers: { Origin: "https://sagashelf.app" },
      body: new URLSearchParams(fields),
    }),
    params: { mediaId },
    context: {},
  } as unknown as Route.ActionArgs);

const form = {
  intent: "save",
  body,
  visibility: "public",
  score: "8",
};

type Answer = {
  init?: { status?: number };
  data?: { ok: boolean; error?: string; sent?: unknown };
};

describe("the page of a review", () => {
  it("starts a new review at the level of the profile", async () => {
    const data = await load();
    expect(data).toMatchObject({
      canWrite: true,
      review: null,
      defaultVisibility: "friends",
      entry: { score: 8, visibility: "public" },
      media: { id: mediaId, path: `/media/anime/frieren-${mediaId}` },
    });
  });

  it("says to start a planned title first, unless a review already exists", async () => {
    mocks.getEntry.mockResolvedValue({ ...entry, status: "planned" });
    expect(await load()).toMatchObject({ canWrite: false });
    mocks.getOwnReview.mockResolvedValue({
      body,
      spoiler: false,
      visibility: "private",
      removed: false,
    });
    expect(await load()).toMatchObject({
      canWrite: true,
      defaultVisibility: "private",
    });
  });

  it("answers 404 for a title the person does not hold", async () => {
    mocks.getEntry.mockResolvedValue(null);
    await expect(load()).rejects.toMatchObject({ init: { status: 404 } });
  });
});

describe("saving a review", () => {
  it("writes it with its fingerprint and an event id, and goes to the reviews of the title", async () => {
    const answer = (await send({ ...form, spoiler: "on" })) as Response;

    expect(answer.status).toBe(303);
    expect(answer.headers.get("Location")).toBe(titlePage);
    expect(mocks.saveReview).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      {
        body,
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
        spoiler: true,
        visibility: "public",
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    );
    // The score did not change, so the entry is not written.
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("writes a changed score to the entry, as it was read", async () => {
    await send({ ...form, score: "" });
    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      { ...entry, score: null },
      entry,
    );
  });

  it("says the score was not saved when the entry changed meanwhile", async () => {
    mocks.saveEntry.mockResolvedValue("conflict");
    const answer = (await send({ ...form, score: "5" })) as Answer;
    expect(answer.init?.status).toBe(409);
    expect(answer.data).toMatchObject({ ok: false, error: "score_conflict" });
  });

  it.each([
    ["too_short", "corta"],
    ["too_long", "a".repeat(5001)],
    ["link", `${body} https://spam.test`],
  ])(
    "refuses a text that is %s before asking the database",
    async (error, text) => {
      const answer = (await send({ ...form, body: text })) as Answer;
      expect(answer.init?.status).toBe(400);
      expect(answer.data).toMatchObject({ ok: false, error });
      expect(mocks.saveReview).not.toHaveBeenCalled();
    },
  );

  it.each(["not_started", "duplicate", "rate_limited", "conflict"] as const)(
    "gives back what was sent when the database answers %s",
    async (result) => {
      mocks.saveReview.mockResolvedValue(result);
      const answer = (await send(form)) as Answer;
      expect(answer.data).toEqual({
        ok: false,
        error: result,
        sent: { body, spoiler: false, visibility: "public", score: 8 },
      });
      expect(answer.init?.status).toBe(result === "conflict" ? 409 : 400);
    },
  );

  it("refuses a form that is not the form, and a request over the limit", async () => {
    const extra = (await send({ ...form, userId: "someone-else" })) as Answer;
    expect(extra.data).toMatchObject({ error: "invalid" });
    mocks.limit.mockResolvedValue({ success: false });
    const limited = (await send(form)) as Answer;
    expect(limited.init?.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith({
      key: expect.stringMatching(/^review:user-1/) as unknown,
    });
  });

  it("deletes the review of the person of the session and goes to the title", async () => {
    const answer = (await send({ intent: "delete" })) as Response;
    expect(mocks.deleteReview).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
    );
    expect(answer.headers.get("Location")).toBe(titlePage);
  });
});
