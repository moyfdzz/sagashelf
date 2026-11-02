import { describe, expect, it } from "vitest";

import type { SagaMember } from "../db/sagas";
import type {
  GenreRecommendation,
  SagaSuggestion,
} from "../db/recommendations";
import {
  becauseShown,
  sagasShown,
  viewGenreItems,
  viewSagaSuggestions,
  worksPerSaga,
} from "./view";

const work = (
  qid: string,
  overrides: Partial<SagaMember> = {},
): SagaMember => ({
  qid,
  format: "anime",
  labels: { en: `Work ${qid}` },
  year: 2000,
  position: 0,
  media: null,
  ...overrides,
});

const saga = (
  slug: string,
  missing: SagaMember[],
  titles: SagaSuggestion["titles"] = { en: slug.toUpperCase() },
): SagaSuggestion => ({ slug, title: slug, titles, missing });

describe("viewGenreItems (SAG-87)", () => {
  const item: GenreRecommendation = {
    mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
    type: "anime",
    title: "Attack on Titan",
    year: 2013,
    because: ["action", "drama", "mystery", "horror"],
  };

  it("gives each title its page, and the first genres as the reason", () => {
    const [view] = viewGenreItems([item]);

    expect(view).toEqual({
      mediaId: item.mediaId,
      type: "anime",
      title: "Attack on Titan",
      year: 2013,
      href: `/media/anime/attack-on-titan-${item.mediaId}`,
      because: ["action", "drama", "mystery"],
    });
    expect(view?.because).toHaveLength(becauseShown);
  });

  it("keeps the order it is given, and says nothing for an empty list", () => {
    const other = {
      ...item,
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
      title: "B",
    };

    expect(viewGenreItems([item, other]).map((view) => view.title)).toEqual([
      "Attack on Titan",
      "B",
    ]);
    expect(viewGenreItems([])).toEqual([]);
  });
});

describe("viewSagaSuggestions (SAG-87)", () => {
  it("names the saga and its works in the language of the visitor, with a link only for what the catalog holds", () => {
    const held = work("Q1", {
      labels: {},
      media: {
        id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
        type: "manga",
        title: "Shingeki",
        titles: { es: "Ataque a los Titanes" },
      },
    });
    const view = viewSagaSuggestions(
      [
        saga("aot", [held, work("Q2", { labels: { es: "La película" } })], {
          es: "Ataque",
          en: "Attack",
        }),
      ],
      "es",
    );

    expect(view).toEqual([
      {
        slug: "aot",
        title: "Ataque",
        more: 0,
        items: [
          {
            qid: "Q1",
            label: "Ataque a los Titanes",
            format: "manga",
            year: 2000,
            href: "/media/manga/ataque-a-los-titanes-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
          },
          {
            qid: "Q2",
            label: "La película",
            format: "anime",
            year: 2000,
            href: null,
          },
        ],
      },
    ]);
  });

  it("falls back to the other language, and to the English name of the saga, and leaves out a work with no name", () => {
    const view = viewSagaSuggestions(
      [
        {
          slug: "x",
          title: "Only English",
          titles: {},
          missing: [
            work("Q1", { labels: { en: "In English" } }),
            work("Q2", { labels: {} }),
          ],
        },
      ],
      "es",
    );

    expect(view[0]?.title).toBe("Only English");
    expect(view[0]?.items.map((entry) => entry.label)).toEqual(["In English"]);
  });

  it("lists the works the saga lacks in the order it gives them, at most six, and counts the rest", () => {
    const many = Array.from({ length: worksPerSaga + 3 }, (_, index) =>
      work(`Q${index + 1}`),
    );

    const [view] = viewSagaSuggestions([saga("long", many)], "en");

    expect(view?.items.map((entry) => entry.qid)).toEqual(
      many.slice(0, worksPerSaga).map((entry) => entry.qid),
    );
    expect(view?.more).toBe(3);
  });

  it("puts first the saga that has the fewest works left, then by address, and shows at most five", () => {
    const sagas = [
      saga("zzz", [work("Q1")]),
      saga("big", [work("Q1"), work("Q2"), work("Q3")]),
      saga("aaa", [work("Q1")]),
      ...["d", "e", "f", "g"].map((slug) =>
        saga(slug, [work("Q1"), work("Q2")]),
      ),
    ];

    const view = viewSagaSuggestions(sagas, "en");

    expect(view.map((entry) => entry.slug)).toEqual([
      "aaa",
      "zzz",
      "d",
      "e",
      "f",
    ]);
    expect(view).toHaveLength(sagasShown);
  });

  it("leaves out a saga with nothing to list, and an empty list says nothing", () => {
    expect(
      viewSagaSuggestions(
        [saga("nameless", [work("Q1", { labels: {} })])],
        "en",
      ),
    ).toEqual([]);
    expect(viewSagaSuggestions([], "en")).toEqual([]);
  });
});
