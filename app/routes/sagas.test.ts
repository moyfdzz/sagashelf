import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/sagas";
import { loader as sitemapLoader } from "./sitemap.xml";
import { headers, loader, meta } from "./sagas";
import type { SagaListItem } from "~server/db/sagas";

const mocks = vi.hoisted(() => ({ listSagas: vi.fn(), locale: "es" }));

vi.mock("~server/db/sagas", () => ({ listSagas: mocks.listSagas }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${key}:${options.title}` : key,
  }),
  getLocale: () => mocks.locale,
}));

const saga = (overrides: Partial<SagaListItem> = {}): SagaListItem => ({
  slug: "attack-on-titan",
  title: "Attack on Titan",
  titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
  works: 13,
  formats: ["anime", "manga"],
  ...overrides,
});

const call = (path: string) =>
  loader({
    request: new Request(`https://sagashelf.app${path}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

beforeEach(() => {
  mocks.locale = "es";
  mocks.listSagas.mockReset().mockResolvedValue([saga()]);
});

describe("the loader of the list of sagas (SAG-245)", () => {
  it("names each saga in the language of the reader and links to its page", async () => {
    const data = await call("/sagas");

    expect(data.sagas).toEqual([
      {
        slug: "attack-on-titan",
        title: "Ataque a los Titanes",
        works: 13,
        formats: ["anime", "manga"],
      },
    ]);
    expect(mocks.listSagas).toHaveBeenCalledWith(
      { fake: "database" },
      { search: "", locale: "es" },
    );
  });

  it("falls back to the English name when there is none in the language", async () => {
    mocks.listSagas.mockResolvedValue([saga({ titles: {} })]);

    expect((await call("/sagas")).sagas[0]?.title).toBe("Attack on Titan");
  });

  it("asks for English names when the reader uses English", async () => {
    mocks.locale = "en";

    await call("/sagas");

    expect(mocks.listSagas.mock.calls[0]?.[1]).toEqual({
      search: "",
      locale: "en",
    });
  });

  it("normalizes what was typed before it searches, and keeps it for the field", async () => {
    const data = await call("/sagas?q=%20%20ÁTaque%20%20a%20");

    expect(data.q).toBe("ÁTaque  a");
    expect(mocks.listSagas.mock.calls[0]?.[1]).toEqual({
      search: "ataque a",
      locale: "es",
    });
  });

  it("cuts a very long text instead of sending it to the database", async () => {
    const data = await call(`/sagas?q=${"a".repeat(500)}`);

    expect([...data.q]).toHaveLength(100);
    expect(mocks.listSagas.mock.calls[0]?.[1].search).toHaveLength(100);
  });

  it("does not list a franchise as a format a person can follow", async () => {
    mocks.listSagas.mockResolvedValue([
      saga({ formats: ["anime", "franchise"] }),
    ]);

    expect((await call("/sagas")).sagas[0]?.formats).toEqual(["anime"]);
  });

  it("never asks who is reading: the list is the same for everybody", async () => {
    const data = await call("/sagas");

    expect(data).not.toHaveProperty("signedIn");
  });

  it("says it is a search only when the text has something to compare", async () => {
    expect((await call("/sagas")).searching).toBe(false);
    expect((await call("/sagas?q=naruto")).searching).toBe(true);
    // Only a combining accent and a space: it normalizes to nothing, so it finds every saga.
    const blank = await call("/sagas?q=%CC%81%20");
    expect(blank.searching).toBe(false);
    expect(mocks.listSagas.mock.calls.at(-1)?.[1].search).toBe("");
  });

  it("is never kept by a shared cache, because the header shows who is signed in", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });

  it("points the canonical address at the list, whatever was searched", async () => {
    const data = await call("/sagas?q=naruto");

    expect(
      meta({ loaderData: data } as unknown as Route.MetaArgs),
    ).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://sagashelf.app/sagas",
    });
  });
});

describe("the loader of the sitemap (SAG-245)", () => {
  it("answers XML that a shared cache may keep, with the published sagas", async () => {
    mocks.listSagas.mockResolvedValue([saga({ slug: "naruto" })]);

    const response = await sitemapLoader();

    expect(response.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await response.text()).toContain(
      "<loc>https://sagashelf.app/sagas/naruto</loc>",
    );
    expect(mocks.listSagas.mock.calls[0]?.[1]).toEqual({
      search: "",
      locale: "es",
    });
  });
});
