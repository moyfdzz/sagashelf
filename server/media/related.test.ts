import { describe, expect, it } from "vitest";

import type { RelatedFormat } from "../db/wikidata-store";
import { groupRelated } from "./related";

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

const entry = (overrides: Partial<RelatedFormat>): RelatedFormat => ({
  qid: "Q1",
  format: "manga",
  labels: { en: "Attack on Titan" },
  media: null,
  ...overrides,
});

describe("groupRelated", () => {
  it("groups by format in a fixed order, and names each item in the language of the visitor", () => {
    const groups = groupRelated(
      [
        entry({ qid: "Q1", format: "game", labels: { es: "Juego" } }),
        entry({
          qid: "Q2",
          format: "anime",
          labels: { es: "Anime", en: "Anime EN" },
        }),
        entry({ qid: "Q3", format: "anime", labels: { en: "Only English" } }),
      ],
      "es",
    );

    expect(groups.map((group) => group.format)).toEqual(["anime", "game"]);
    expect(groups[0]?.items.map((item) => item.label)).toEqual([
      "Anime",
      "Only English",
    ]);
  });

  it("links a title the catalog holds, by the name it has there, and puts it under its own type", () => {
    const [group] = groupRelated(
      [
        entry({
          format: "other",
          labels: { en: "Wikidata name" },
          media: {
            id,
            type: "manga",
            title: "Berserk",
            titles: { es: "Berserk ES" },
          },
        }),
      ],
      "es",
    );

    expect(group).toEqual({
      format: "manga",
      items: [
        {
          qid: "Q1",
          label: "Berserk ES",
          href: `/media/manga/berserk-es-${id}`,
        },
      ],
    });
  });

  it("leaves out an item with no name, a franchise and a format it does not know", () => {
    expect(
      groupRelated(
        [
          entry({ labels: {} }),
          entry({ qid: "Q2", format: "franchise" }),
          entry({ qid: "Q3", format: "nope" as never }),
        ],
        "en",
      ),
    ).toEqual([]);
  });
});
