import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library.$mediaId";
import { action, loader } from "./library.$mediaId";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getEntry: vi.fn(),
  getSeasonCounts: vi.fn(),
  saveEntry: vi.fn(),
  removeEntry: vi.fn(),
  rewatchEntry: vi.fn(),
  listViewings: vi.fn(),
  addViewing: vi.fn(),
  saveViewing: vi.fn(),
  removeViewing: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/library", () => ({
  getEntry: mocks.getEntry,
  getSeasonCounts: mocks.getSeasonCounts,
  saveEntry: mocks.saveEntry,
  removeEntry: mocks.removeEntry,
  rewatchEntry: mocks.rewatchEntry,
  totalEpisodes: (seasons: { episodes: number }[]) =>
    seasons.reduce((sum, season) => sum + season.episodes, 0),
}));
vi.mock("~server/db/viewings", () => ({
  listViewings: mocks.listViewings,
  addViewing: mocks.addViewing,
  saveViewing: mocks.saveViewing,
  removeViewing: mocks.removeViewing,
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

const stored = {
  mediaId,
  title: "Ataque a los Titanes",
  type: "anime",
  year: 2013,
  imageUrl: "https://image.tmdb.org/t/p/w500/aot.jpg",
  status: "in_progress",
  progress: 2,
  progressUnit: null,
  progressTotal: null,
  score: 8,
  startedAt: "2026-01-02",
  finishedAt: null,
  notes: "nota",
  visibility: "private",
  updatedAt: new Date(),
};

const seasons = [
  { number: 1, episodes: 2 },
  { number: 2, episodes: 2 },
];

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getEntry.mockReset().mockResolvedValue(stored);
  mocks.getSeasonCounts.mockReset().mockResolvedValue(seasons);
  mocks.saveEntry.mockReset().mockResolvedValue(true);
  mocks.removeEntry.mockReset().mockResolvedValue(true);
  mocks.rewatchEntry.mockReset().mockResolvedValue(true);
  mocks.listViewings.mockReset().mockResolvedValue([]);
  mocks.addViewing.mockReset().mockResolvedValue("ok");
  mocks.saveViewing.mockReset().mockResolvedValue(true);
  mocks.removeViewing.mockReset().mockResolvedValue(true);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const load = (id = mediaId) =>
  loader({
    request: new Request(`https://sagashelf.app/library/${id}`),
    params: { mediaId: id },
    context: {},
  } as unknown as Route.LoaderArgs);

function send(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  id = mediaId,
) {
  return action({
    request: new Request(`https://sagashelf.app/library/${id}`, {
      method: "POST",
      headers: { Origin: "https://sagashelf.app", ...headers },
      body: new URLSearchParams(fields),
    }),
    params: { mediaId: id },
    context: {},
  } as unknown as Route.ActionArgs);
}

const form = {
  intent: "save",
  status: "in_progress",
  progress: "2",
  score: "8",
  startedAt: "2026-01-02",
  finishedAt: "",
  notes: "nota",
  visibility: "private",
};

async function statusOf(promise: Promise<unknown>) {
  try {
    const result = await promise;
    return (
      (result as { init?: { status: number } }).init?.status ??
      (result as Response).status
    );
  } catch (thrown) {
    return (
      (thrown as { init?: { status: number } }).init?.status ??
      (thrown as Response).status
    );
  }
}

describe("the entry page loader", () => {
  it("shows the entry of the person with where the progress leaves them", async () => {
    const result = (await load()) as unknown as Record<string, unknown>;

    expect(mocks.getEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      "es",
    );
    expect(result).toMatchObject({
      entry: { status: "in_progress", progress: 2, score: 8 },
      media: {
        title: "Ataque a los Titanes",
        poster: "/img/tmdb/w185/aot.jpg",
        detailPath: `/media/anime/ataque-a-los-titanes-${mediaId}`,
      },
      totalEpisodes: 4,
      progressAt: { season: 1, episode: 2 },
    });
  });

  it("answers 404 when the person has no such entry, which is also what somebody else's looks like", async () => {
    mocks.getEntry.mockResolvedValue(null);

    expect(await statusOf(load())).toBe(404);
  });

  it("answers 404 for an id that is not an id, without asking the database", async () => {
    expect(await statusOf(load("not-an-id"))).toBe(404);
    expect(mocks.getEntry).not.toHaveBeenCalled();
  });
});

describe("the link back to the library", () => {
  const backFrom = async (referer: string | null, suffix = "") =>
    (
      (await loader({
        request: new Request(
          `https://sagashelf.app/library/${mediaId}${suffix}`,
          { headers: referer === null ? {} : { Referer: referer } },
        ),
        params: { mediaId },
        context: {},
      } as unknown as Route.LoaderArgs)) as unknown as {
        backToLibrary: string | null;
      }
    ).backToLibrary;

  it("goes back to the library as the person left it", async () => {
    expect(
      await backFrom(
        "https://sagashelf.app/library?type=series&q=titanes&completed_page=2",
      ),
    ).toBe("/library?type=series&q=titanes&completed_page=2");
  });

  it("has none for a bookmark, the search, another site or no Referer", async () => {
    for (const referer of [
      null,
      "https://sagashelf.app/search?q=dune",
      "https://evil.example/library?type=book",
    ]) {
      expect(await backFrom(referer)).toBeNull();
    }
  });

  it("never reflects the Referer: only what the library knows, in an address of the library", async () => {
    expect(
      await backFrom(
        "https://sagashelf.app/library?type=book&next=https://evil.example",
      ),
    ).toBe("/library?type=book");
  });

  it("is not worked out again when the loader runs after a save, where the Referer is the entry itself", async () => {
    expect(
      await backFrom(`https://sagashelf.app/library/${mediaId}`, ".data"),
    ).toBeNull();
    expect(
      await backFrom("https://sagashelf.app/library?type=book", ".data"),
    ).toBeNull();
  });
});

describe("saving an entry", () => {
  it("saves what the rules decide, for the person of the session", async () => {
    const result = await send({ ...form, progress: "4" });

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({ status: "completed", progress: 4 }),
    );
    expect(result).toMatchObject({
      init: { headers: { "Cache-Control": "private, no-store" } },
      data: { ok: true, saved: "save" },
    });
  });

  it("answers with an error on the field when the progress passes the last episode", async () => {
    const result = await send({ ...form, progress: "5" });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { ok: false, errors: { progress: "progress_too_high" } },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("tracks a book page by page and completes it at the last page", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, type: "book" });
    mocks.getSeasonCounts.mockResolvedValue([]);

    await send({
      ...form,
      progress: "320",
      progressUnit: "pages",
      progressTotal: "320",
    });

    expect(mocks.saveEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({
        status: "completed",
        progress: 320,
        progressUnit: "pages",
        progressTotal: 320,
      }),
    );
  });

  it("answers with an error on the field when a book passes its total", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, type: "book" });
    mocks.getSeasonCounts.mockResolvedValue([]);

    const result = await send({
      ...form,
      progress: "321",
      progressUnit: "pages",
      progressTotal: "320",
    });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { ok: false, errors: { progress: "progress_too_high" } },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("names the field of an invalid unit or total", async () => {
    const result = await send({
      ...form,
      progressUnit: "leagues",
      progressTotal: "0",
    });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: {
        ok: false,
        errors: { progressUnit: "invalid", progressTotal: "invalid" },
      },
    });
  });

  it("offers the units of the kind of title in the loader", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, type: "manga" });

    const result = (await load()) as unknown as Record<string, unknown>;

    expect(result.progressUnits).toEqual(["chapters", "volumes"]);
  });

  it("answers with an error on the field when the dates do not line up", async () => {
    const result = await send({
      ...form,
      status: "completed",
      progress: "4",
      finishedAt: "2025-01-01",
    });

    expect(result).toMatchObject({
      data: { ok: false, errors: { finishedAt: "dates_order" } },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("names the field of an invalid value, and does not echo the value", async () => {
    const result = await send({ ...form, score: "11" });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { ok: false, errors: { score: "invalid" } },
    });
    expect(JSON.stringify(result)).not.toContain("11");
  });

  it("reports notes that are too long with their own message", async () => {
    const result = await send({ ...form, notes: "a".repeat(2001) });

    expect(result).toMatchObject({
      data: { errors: { notes: "notes_too_long" } },
    });
  });

  it("treats a field the form does not have as a request that is not from the form", async () => {
    const result = await send({ ...form, userId: "someone-else" });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { errors: { form: "generic" } },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("answers 404 when the person has no such entry", async () => {
    mocks.getEntry.mockResolvedValue(null);

    expect(await statusOf(send(form))).toBe(404);
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("answers 404 when the entry disappears between reading and writing", async () => {
    mocks.saveEntry.mockResolvedValue(false);

    expect(await statusOf(send(form))).toBe(404);
  });
});

describe("watching a title again", () => {
  it("starts again a completed title, saving the run that ends in the history", async () => {
    mocks.getEntry.mockResolvedValue({
      ...stored,
      status: "completed",
      progress: 4,
      finishedAt: "2026-02-01",
    });

    const result = await send({ intent: "rewatch" });

    expect(mocks.saveEntry).not.toHaveBeenCalled();
    expect(mocks.rewatchEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      expect.objectContaining({
        status: "in_progress",
        progress: 0,
        finishedAt: null,
      }),
    );
    expect(result).toMatchObject({ data: { ok: true, saved: "rewatch" } });
  });

  it("says the history is full when the run cannot be saved", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, status: "completed" });
    mocks.rewatchEntry.mockResolvedValue(false);

    const result = await send({ intent: "rewatch" });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { ok: false, errors: { viewings: "viewings_limit" } },
    });
  });

  it("refuses a title that is not completed", async () => {
    const result = await send({ intent: "rewatch" });

    expect(result).toMatchObject({
      init: { status: 400 },
      data: { ok: false, errors: { form: "not_completed" } },
    });
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });
});

describe("the earlier viewings", () => {
  const viewing = {
    viewStartedOn: "2025-05-01",
    viewFinishedOn: "2025-05-03",
    viewNotes: "En el cine",
  };
  const viewingId = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa";

  it("lists them in the loader with the times watched", async () => {
    mocks.getEntry.mockResolvedValue({ ...stored, status: "completed" });
    mocks.listViewings.mockResolvedValue([
      { id: viewingId, startedOn: null, finishedOn: null, notes: null },
    ]);

    const result = (await load()) as unknown as Record<string, unknown>;

    expect(mocks.listViewings).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
    );
    expect(result).toMatchObject({ timesWatched: 2 });
  });

  it("adds one for the person of the session", async () => {
    const result = await send({ intent: "viewing_add", ...viewing });

    expect(mocks.addViewing).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      {
        startedOn: "2025-05-01",
        finishedOn: "2025-05-03",
        notes: "En el cine",
      },
    );
    expect(result).toMatchObject({ data: { ok: true, saved: "viewing_add" } });
  });

  it("accepts a viewing with no dates and no notes", async () => {
    await send({
      intent: "viewing_add",
      viewStartedOn: "",
      viewFinishedOn: "",
      viewNotes: "",
    });

    expect(mocks.addViewing).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      { startedOn: null, finishedOn: null, notes: null },
    );
  });

  it("refuses a viewing that ends before it starts, and notes that are too long", async () => {
    const dates = await send({
      intent: "viewing_add",
      ...viewing,
      viewFinishedOn: "2025-04-01",
    });
    const notes = await send({
      intent: "viewing_add",
      ...viewing,
      viewNotes: "x".repeat(501),
    });

    expect(dates).toMatchObject({
      init: { status: 400 },
      data: { errors: { viewFinishedOn: "dates_order" } },
    });
    expect(notes).toMatchObject({
      init: { status: 400 },
      data: { errors: { viewNotes: "notes_too_long" } },
    });
    expect(mocks.addViewing).not.toHaveBeenCalled();
  });

  it("says the history is full at the limit, and 404 when there is no entry", async () => {
    mocks.addViewing.mockResolvedValueOnce("limit");
    expect(await send({ intent: "viewing_add", ...viewing })).toMatchObject({
      init: { status: 400 },
      data: { errors: { viewings: "viewings_limit" } },
    });

    mocks.addViewing.mockResolvedValueOnce("missing");
    expect(await statusOf(send({ intent: "viewing_add", ...viewing }))).toBe(
      404,
    );
  });

  it("changes and removes one of the person, and answers 404 for one that is not theirs", async () => {
    await send({ intent: "viewing_save", viewingId, ...viewing });
    expect(mocks.saveViewing).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      viewingId,
      {
        startedOn: "2025-05-01",
        finishedOn: "2025-05-03",
        notes: "En el cine",
      },
    );

    await send({ intent: "viewing_remove", viewingId });
    expect(mocks.removeViewing).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
      viewingId,
    );

    mocks.saveViewing.mockResolvedValue(false);
    mocks.removeViewing.mockResolvedValue(false);
    expect(
      await statusOf(send({ intent: "viewing_save", viewingId, ...viewing })),
    ).toBe(404);
    expect(await statusOf(send({ intent: "viewing_remove", viewingId }))).toBe(
      404,
    );
  });

  it("refuses a field the form does not have and an id that is not an id", async () => {
    expect(
      await send({ intent: "viewing_add", ...viewing, userId: "other" }),
    ).toMatchObject({
      init: { status: 400 },
      data: { errors: { form: "generic" } },
    });
    expect(
      await send({ intent: "viewing_remove", viewingId: "not-an-id" }),
    ).toMatchObject({ init: { status: 400 } });
    expect(mocks.removeViewing).not.toHaveBeenCalled();
  });
});

describe("removing an entry", () => {
  it("removes the entry of the person and goes back to the library", async () => {
    const response = (await send({ intent: "remove" })) as Response;

    expect(mocks.removeEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/library");
  });
});

describe("every write", () => {
  it("refuses a form sent from another site, before looking at the session", async () => {
    expect(await statusOf(send(form, { Origin: "https://evil.example" }))).toBe(
      403,
    );
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big", async () => {
    expect(await statusOf(send(form, { "Content-Length": "20000" }))).toBe(413);
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("is rate limited per person", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    expect(await statusOf(send(form))).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain("library:user-1");
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it("needs a session: the person never comes from the form", async () => {
    mocks.requireUser.mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/sign-in" } }),
    );

    expect(await statusOf(send(form))).toBe(302);
    expect(mocks.saveEntry).not.toHaveBeenCalled();
    expect(mocks.removeEntry).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that is not an id", async () => {
    expect(await statusOf(send(form, {}, "not-an-id"))).toBe(404);
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });
});
