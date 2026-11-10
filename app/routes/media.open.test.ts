import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/media.open";
import { loader } from "./media.open";
import { ProviderError } from "~server/providers/http";

const mocks = vi.hoisted(() => ({
  findMediaByExternalId: vi.fn(),
  importMedia: vi.fn(),
  getOptionalUser: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/db/media-detail", () => ({
  findMediaByExternalId: mocks.findMediaByExternalId,
}));
vi.mock("~server/media/import", () => ({ importMedia: mocks.importMedia }));
vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getMediaProviders: () => [],
  getOpenLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/title-budget", () => ({
  claimTitleFetch: async () => "ok",
}));
vi.mock("~/middleware/i18next", () => ({ getLocale: () => "es" }));

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

beforeEach(() => {
  mocks.findMediaByExternalId.mockReset().mockResolvedValue(null);
  mocks.importMedia
    .mockReset()
    .mockResolvedValue({ id, type: "movie", title: "Matrix" });
  mocks.getOptionalUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const open = (query: string) =>
  loader({
    request: new Request(`http://localhost/media/open${query}`),
    context: {},
  } as unknown as Route.LoaderArgs);

async function status(promise: Promise<unknown>) {
  try {
    const result = await promise;
    return (result as Response).status;
  } catch (thrown) {
    return (
      (thrown as { init?: { status: number } }).init?.status ??
      (thrown as Response).status
    );
  }
}

describe("opening a title from a search result", () => {
  it("saves a new title for a person with a session and goes to its own address", async () => {
    const response = (await open("?provider=tmdb&id=movie%2F603")) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/media/movie/matrix-${id}`);
    expect(mocks.importMedia).toHaveBeenCalledWith(
      expect.anything(),
      "tmdb",
      "movie/603",
      "es",
    );
  });

  it("goes straight to a title we already hold, without a session, the provider or the limit", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);
    mocks.findMediaByExternalId.mockResolvedValue({
      id,
      type: "anime",
      title: "Ataque a los Titanes",
    });

    const response = (await open("?provider=tmdb&id=tv%2F1429")) as Response;

    expect(response.headers.get("Location")).toBe(
      `/media/anime/ataque-a-los-titanes-${id}`,
    );
    expect(mocks.getOptionalUser).not.toHaveBeenCalled();
    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  describe("a title that only a provider knows (SAG-130)", () => {
    it("sends a visitor to sign in, and back to this same address, and saves nothing", async () => {
      mocks.getOptionalUser.mockResolvedValue(null);

      const response = (await open(
        "?provider=tmdb&id=movie%2F603",
      )) as Response;

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/sign-in?redirectTo=${encodeURIComponent("/media/open?provider=tmdb&id=movie%2F603")}`,
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.importMedia).not.toHaveBeenCalled();
      expect(mocks.limit).not.toHaveBeenCalled();
    });

    it("does not call the provider for a visitor, however many titles are asked for", async () => {
      mocks.getOptionalUser.mockResolvedValue(null);

      for (let n = 0; n < 25; n++) {
        await open(`?provider=tmdb&id=movie%2F${n}`);
      }

      expect(mocks.importMedia).not.toHaveBeenCalled();
    });

    it("limits the person, with a key of their own, before it asks the provider", async () => {
      await open("?provider=tmdb&id=movie%2F603");

      expect(mocks.limit).toHaveBeenCalledTimes(1);
      expect(mocks.limit.mock.calls[0]?.[0].key).toBe(
        "media-open:user-1:unknown",
      );
    });

    it("keeps the limit of one person apart from the limit of another", async () => {
      mocks.getOptionalUser.mockResolvedValue({ id: "user-2" });

      await open("?provider=tmdb&id=movie%2F603");

      expect(mocks.limit.mock.calls[0]?.[0].key).toBe(
        "media-open:user-2:unknown",
      );
    });
  });

  it.each([
    ["no parameters", ""],
    ["an unknown provider", "?provider=evil&id=movie%2F1"],
    ["an id with a query in it", "?provider=tmdb&id=movie%2F1%3Fx%3D1"],
    ["an id that is too long", `?provider=tmdb&id=${"a".repeat(65)}`],
  ])(
    "answers 400 for %s, and does not look anything up",
    async (_name, query) => {
      expect(await status(open(query))).toBe(400);
      expect(mocks.findMediaByExternalId).not.toHaveBeenCalled();
      expect(mocks.getOptionalUser).not.toHaveBeenCalled();
      expect(mocks.importMedia).not.toHaveBeenCalled();
    },
  );

  it("answers 404 when the provider does not know the title", async () => {
    mocks.importMedia.mockResolvedValue(null);

    expect(await status(open("?provider=tmdb&id=movie%2F0"))).toBe(404);
  });

  it("answers 502 when the provider fails", async () => {
    mocks.importMedia.mockRejectedValue(new ProviderError("tmdb", "timeout"));

    expect(await status(open("?provider=tmdb&id=movie%2F603"))).toBe(502);
  });

  it("answers 429 when the caller is over the limit, before asking the provider", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    expect(await status(open("?provider=tmdb&id=movie%2F603"))).toBe(429);
    expect(mocks.importMedia).not.toHaveBeenCalled();
  });
});
