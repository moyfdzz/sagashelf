import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/sagas.$slug";
import { headers, loader, meta } from "./sagas.$slug";
import type { SagaPage } from "~server/db/sagas";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getSagaBySlug: vi.fn(),
  getSagaProgress: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/db/sagas", () => ({
  getSagaBySlug: mocks.getSagaBySlug,
  getSagaProgress: mocks.getSagaProgress,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: { title?: string; count?: number }) =>
      options?.title ? `${key}:${options.title}` : key,
  }),
  getLocale: () => mocks.locale,
}));

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

function saga(overrides: Partial<SagaPage> = {}): SagaPage {
  return {
    id: "saga-1",
    slug: "attack-on-titan",
    title: "Attack on Titan",
    titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
    members: [
      {
        qid: "Q1",
        format: "manga",
        labels: { en: "Attack on Titan" },
        year: 2009,
        position: 0,
        media: null,
      },
      {
        qid: "Q2",
        format: "anime",
        labels: {},
        year: 2013,
        position: 1,
        media: {
          id: mediaId,
          type: "anime",
          title: "Attack on Titan",
          titles: {},
        },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.locale = "es";
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  mocks.getSagaBySlug.mockReset().mockResolvedValue(saga());
  mocks.getSagaProgress.mockReset().mockResolvedValue(new Map());
});

const load = (slug: string, search = "") =>
  loader({
    params: { slug },
    request: new Request(`https://sagashelf.app/sagas/${slug}${search}`),
    context: {},
  } as unknown as Route.LoaderArgs);

async function thrownStatus(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return (thrown as { init?: { status: number } }).init?.status;
  }
  return undefined;
}

describe("the saga page loader (SAG-25)", () => {
  it("shows the saga in the language of the visitor, with its works grouped by format", async () => {
    const result = await load("attack-on-titan");

    expect(mocks.getSagaBySlug).toHaveBeenCalledWith(
      { fake: "database" },
      "attack-on-titan",
    );
    expect(result).toMatchObject({
      title: "Ataque a los Titanes",
      count: 2,
      canonicalUrl: "https://sagashelf.app/sagas/attack-on-titan",
      signedIn: false,
    });
    expect(result.groups.map((group) => group.format)).toEqual([
      "anime",
      "manga",
    ]);
  });

  it("is a 404 for an address that is not a slug, and for a saga that does not exist", async () => {
    expect(await thrownStatus(load("Not A Slug"))).toBe(404);
    expect(await thrownStatus(load("a".repeat(81)))).toBe(404);
    expect(mocks.getSagaBySlug).not.toHaveBeenCalled();

    mocks.getSagaBySlug.mockResolvedValue(null);
    expect(await thrownStatus(load("nothing-here"))).toBe(404);
  });

  it("asks for no entries of a visitor, and points them to sign in", async () => {
    const result = await load("attack-on-titan");

    expect(mocks.getSagaProgress).not.toHaveBeenCalled();
    expect(result.signedIn).toBe(false);
    expect(result.signInPath).toContain("/sign-in");
  });

  it("asks for the entries of the signed-in person, only for the titles it holds, and shows their progress", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    mocks.getSagaProgress.mockResolvedValue(
      new Map([[mediaId, { status: "completed", progress: 87, total: 87 }]]),
    );

    const result = await load("attack-on-titan");

    expect(mocks.getSagaProgress).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      [mediaId],
    );
    expect(result.totals).toEqual({ inCatalog: 1, completed: 1, percent: 100 });
    // Everything the catalog holds is finished, so there is nowhere to go on to.
    expect(result.hint).toBeNull();
  });

  it("offers the order of the story only when it differs from the release order", async () => {
    const same = await load("attack-on-titan", "?order=story");
    expect(same).toMatchObject({ canChooseOrder: false, order: "release" });

    const prequel = saga();
    prequel.members.push({
      qid: "Q3",
      format: "movie",
      labels: { en: "A prequel" },
      year: 2020,
      position: -1,
      media: null,
    });
    mocks.getSagaBySlug.mockResolvedValue(prequel);

    const release = await load("attack-on-titan");
    const story = await load("attack-on-titan", "?order=story");
    expect(release).toMatchObject({ canChooseOrder: true, order: "release" });
    expect(story).toMatchObject({ canChooseOrder: true, order: "story" });
    expect(story.hint?.label).toBe("A prequel");
    expect(release.hint?.label).toBe("Attack on Titan");
  });

  it("names the saga in English for an English visitor", async () => {
    mocks.locale = "en";

    expect((await load("attack-on-titan")).title).toBe("Attack on Titan");
  });

  it("is private, because it shows what the person has done", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });

  it("has a title, a description and a canonical address for the search engines", async () => {
    const loaderData = await load("attack-on-titan");

    const tags = meta({ loaderData } as unknown as Route.MetaArgs);

    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://sagashelf.app/sagas/attack-on-titan",
    });
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://sagashelf.app/sagas/attack-on-titan",
    });
    expect(tags.some((tag) => "title" in tag && tag.title)).toBe(true);
    expect(
      tags.some((tag) => "name" in tag && tag.name === "description"),
    ).toBe(true);
  });
});
