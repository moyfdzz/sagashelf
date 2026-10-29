import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library.add-external";
import { action, loader } from "./library.add-external";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  addEntry: vi.fn(),
  findMediaByExternalId: vi.fn(),
  importMedia: vi.fn(),
  writeLimit:
    vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  searchLimit:
    vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/db/library", () => ({ addEntry: mocks.addEntry }));
vi.mock("~server/db/media-detail", () => ({
  findMediaByExternalId: mocks.findMediaByExternalId,
}));
vi.mock("~server/media/import", () => ({ importMedia: mocks.importMedia }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getMediaProviders: () => [{ id: "tmdb" }],
  getWriteLimiter: () => ({ limit: mocks.writeLimit }),
  getSearchLimiter: () => ({ limit: mocks.searchLimit }),
}));
vi.mock("~/middleware/i18next", () => ({
  getLocale: () => mocks.locale,
}));

const savedId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const saved = { id: savedId, type: "series", title: "The Pitt" };
const fields = { provider: "tmdb", id: "tv/250307" };
const fetchHeaders = { "Sec-Fetch-Dest": "empty" };

beforeEach(() => {
  mocks.locale = "es";
  mocks.getOptionalUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.addEntry.mockReset().mockResolvedValue(true);
  mocks.findMediaByExternalId.mockReset().mockResolvedValue(null);
  mocks.importMedia.mockReset().mockResolvedValue(saved);
  mocks.writeLimit.mockReset().mockResolvedValue({ success: true });
  mocks.searchLimit.mockReset().mockResolvedValue({ success: true });
});

function send(
  form: Record<string, string> = fields,
  headers: Record<string, string> = fetchHeaders,
) {
  return action({
    request: new Request("https://sagashelf.app/library/add-external", {
      method: "POST",
      headers: { Origin: "https://sagashelf.app", ...headers },
      body: new URLSearchParams(form),
    }),
    context: {},
    params: {},
  } as unknown as Route.ActionArgs);
}

// A `data()` answer keeps its status in `init`, a `Response` in `status`; either may be thrown.
async function statusOf(promise: Promise<unknown>) {
  const read = (value: unknown) =>
    (value as { init?: { status: number } }).init?.status ??
    (value as Response).status;
  try {
    return read(await promise);
  } catch (thrown) {
    return read(thrown);
  }
}

describe("adding a title that a search found", () => {
  it("saves a title we do not hold, adds it for the person of the session and says where its page is", async () => {
    const result = await send();

    expect(mocks.importMedia).toHaveBeenCalledWith(
      { db: { fake: "database" }, providers: [{ id: "tmdb" }] },
      "tmdb",
      "tv/250307",
      "es",
    );
    expect(mocks.addEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      savedId,
    );
    expect(result).toMatchObject({
      init: { headers: { "Cache-Control": "private, no-store" } },
      data: {
        ok: true,
        mediaId: savedId,
        href: `/media/series/the-pitt-${savedId}`,
      },
    });
  });

  it("asks the provider in the language of the site", async () => {
    mocks.locale = "en";

    await send();

    expect(mocks.importMedia.mock.calls[0]?.[3]).toBe("en");
  });

  it("does not call the provider, nor count against the search limit, for a title we already hold", async () => {
    mocks.findMediaByExternalId.mockResolvedValue(saved);

    const result = await send();

    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.searchLimit).not.toHaveBeenCalled();
    expect(mocks.addEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      savedId,
    );
    expect(result).toMatchObject({ data: { ok: true, mediaId: savedId } });
  });

  it("counts the call to the provider against the limit of the search", async () => {
    mocks.searchLimit.mockResolvedValue({ success: false });

    const result = (await send()) as Response;

    expect(result.status).toBe(429);
    expect(mocks.searchLimit).toHaveBeenCalledWith({
      key: expect.stringContaining("media-open"),
    });
    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("answers with data, not an error thrown to the page, when the provider does not know the title", async () => {
    mocks.importMedia.mockResolvedValue(null);

    expect(await send()).toMatchObject({
      init: { status: 404 },
      data: { ok: false, error: "not_found" },
    });
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("answers 502 as data when the provider is down", async () => {
    const { ProviderError } = await import("~server/providers/http");
    mocks.importMedia.mockRejectedValue(new ProviderError("tmdb", "http", 503));

    expect(await send()).toMatchObject({
      init: { status: 502 },
      data: { ok: false, error: "unavailable" },
    });
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("does not hide a bug as a provider error", async () => {
    mocks.importMedia.mockRejectedValue(new Error("a bug"));

    await expect(send()).rejects.toThrow("a bug");
  });

  it("answers 404 as data for a title that is not ours to add", async () => {
    mocks.addEntry.mockResolvedValue(false);

    expect(await send()).toMatchObject({
      init: { status: 404 },
      data: { ok: false, error: "not_found" },
    });
  });

  it("answers 400 as data for a provider or an id that is not valid, or a field that is not the form", async () => {
    for (const form of [
      { provider: "evil", id: "tv/1" },
      { provider: "tmdb", id: "tv 1" },
      { provider: "tmdb", id: "tv/1?x=1" },
      { provider: "tmdb", id: "x".repeat(65) },
      { provider: "tmdb", id: "" },
      { provider: "tmdb" },
      { provider: "tmdb", id: "tv/1", userId: "someone-else" },
    ] as Record<string, string>[]) {
      expect(await send(form)).toMatchObject({
        init: { status: 400 },
        data: { ok: false, error: "invalid_request" },
      });
    }
    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("takes the person from the session and never from the form", async () => {
    await send({ ...fields, userId: "someone-else" });
    expect(mocks.addEntry).not.toHaveBeenCalled();

    await send();
    expect(mocks.addEntry.mock.calls[0]?.[1]).toBe("user-1");
  });

  it("sends a visitor to sign in and back, and never saves anything for them", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);

    const response = (await send(fields, {
      ...fetchHeaders,
      Referer: "https://sagashelf.app/search?q=pitt",
    })) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toContain("/sign-in");
    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("refuses a form sent from another site, before looking at the session", async () => {
    expect(
      await statusOf(
        send(fields, { ...fetchHeaders, Origin: "https://evil.example" }),
      ),
    ).toBe(403);
    expect(mocks.getOptionalUser).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big", async () => {
    expect(
      await statusOf(
        send(fields, { ...fetchHeaders, "Content-Length": "5000" }),
      ),
    ).toBe(413);
    expect(mocks.importMedia).not.toHaveBeenCalled();
  });

  it("is rate limited per person, with the limiter of the writes", async () => {
    mocks.writeLimit.mockResolvedValue({ success: false });

    expect(await statusOf(send())).toBe(429);
    expect(mocks.writeLimit).toHaveBeenCalledWith({
      key: expect.stringContaining("library:user-1"),
    });
    expect(mocks.importMedia).not.toHaveBeenCalled();
  });

  describe("without JavaScript, where the form is a document", () => {
    const document = {
      "Sec-Fetch-Dest": "document",
      Referer: "https://sagashelf.app/search?q=the+pitt&type=series",
    };

    it("takes the person to their entry", async () => {
      const response = (await send(fields, document)) as Response;

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`/library/${savedId}`);
    });

    it("sends them back to the search they came from when it cannot be added", async () => {
      mocks.importMedia.mockResolvedValue(null);

      const response = (await send(fields, document)) as Response;

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(
        "/search?q=the+pitt&type=series",
      );
    });

    it("sends them to the plain search when the Referer is not a search", async () => {
      mocks.importMedia.mockResolvedValue(null);

      for (const referer of [
        "https://evil.example/search?q=pitt",
        "https://sagashelf.app/library",
      ]) {
        const response = (await send(fields, {
          "Sec-Fetch-Dest": "document",
          Referer: referer,
        })) as Response;

        expect(response.headers.get("Location")).toBe("/search");
      }
    });
  });

  it("is only for a POST", () => {
    expect(() => loader()).toThrowError();
  });
});
