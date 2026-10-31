import { describe, expect, it } from "vitest";

import type { SagaMember, SagaProgress } from "../db/sagas";
import {
  fractionOf,
  groupMembers,
  orderMembers,
  ordersDiffer,
  sagaTotals,
  startHint,
} from "./view";

const media = (id: string, type: SagaMember["format"], title: string) => ({
  id,
  type: type as "anime" | "movie" | "series" | "manga" | "book",
  title,
  titles: {},
});

const member = (
  overrides: Partial<SagaMember> & { qid: string },
): SagaMember => ({
  format: "anime",
  labels: { en: overrides.qid },
  year: null,
  position: 0,
  media: null,
  ...overrides,
});

/** A manga (2009) that came first, an anime (2013), a film (2015) and a game only Wikidata knows. */
const members: SagaMember[] = [
  member({
    qid: "Q3",
    format: "movie",
    year: 2015,
    position: 2,
    media: media("m-film", "movie", "La película"),
  }),
  member({
    qid: "Q1",
    format: "manga",
    year: 2009,
    position: 0,
    media: media("m-manga", "manga", "El manga"),
  }),
  member({
    qid: "Q2",
    format: "anime",
    year: 2013,
    position: 1,
    media: media("m-anime", "anime", "El anime"),
  }),
  member({
    qid: "Q4",
    format: "game",
    year: 2016,
    position: 3,
    labels: { en: "The game" },
  }),
];

describe("orderMembers", () => {
  it("orders by release year, with no year last, or by the place in the story", () => {
    const noYear = member({ qid: "Q9", year: null, position: 0 });

    expect(
      orderMembers([...members, noYear], "release").map((m) => m.qid),
    ).toEqual(["Q1", "Q2", "Q3", "Q4", "Q9"]);
    expect(orderMembers(members, "story").map((m) => m.qid)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
    ]);
  });

  it("breaks a tie of years by the place in the story, and does not change the list it is given", () => {
    const tied = [
      member({ qid: "Qb", year: 2000, position: 1 }),
      member({ qid: "Qa", year: 2000, position: 0 }),
    ];

    expect(orderMembers(tied, "release").map((m) => m.qid)).toEqual([
      "Qa",
      "Qb",
    ]);
    expect(tied[0]?.qid).toBe("Qb");
  });
});

describe("ordersDiffer", () => {
  it("is false when the story is told in the order the works came out", () => {
    expect(ordersDiffer(members)).toBe(false);
  });

  it("is true when the story puts a later work first", () => {
    const prequel = member({ qid: "Q5", year: 2020, position: -1 });

    expect(ordersDiffer([...members, prequel])).toBe(true);
  });
});

describe("fractionOf", () => {
  it("is 1 for a finished title, 0 for a planned one or none, and how far for the rest", () => {
    const entry = (overrides: Partial<SagaProgress>): SagaProgress => ({
      status: "in_progress",
      progress: 0,
      total: null,
      ...overrides,
    });

    expect(fractionOf(undefined)).toBe(0);
    expect(fractionOf(entry({ status: "completed" }))).toBe(1);
    expect(
      fractionOf(entry({ status: "planned", progress: 3, total: 4 })),
    ).toBe(0);
    expect(fractionOf(entry({ progress: 25, total: 100 }))).toBe(0.25);
    expect(fractionOf(entry({ progress: 5 }))).toBe(0);
    expect(fractionOf(entry({ progress: 9, total: 4 }))).toBe(1);
  });
});

describe("sagaTotals", () => {
  it("averages over the works the catalog holds, and counts the finished ones", () => {
    const progress = new Map<string, SagaProgress>([
      ["m-manga", { status: "completed", progress: 10, total: 10 }],
      ["m-anime", { status: "in_progress", progress: 5, total: 10 }],
    ]);

    // Three works are held: 1, 0.5 and 0 (the film, which the person does not hold).
    expect(sagaTotals(members, progress)).toEqual({
      inCatalog: 3,
      completed: 1,
      percent: 50,
    });
  });

  it("has no percent when the catalog holds none of the works", () => {
    expect(sagaTotals([member({ qid: "Q4" })], new Map())).toEqual({
      inCatalog: 0,
      completed: 0,
      percent: null,
    });
  });
});

describe("startHint", () => {
  const ordered = orderMembers(members, "release");

  it("starts at the first work when the person has nothing in the saga", () => {
    expect(startHint(ordered, new Map())).toMatchObject({
      kind: "start",
      member: { qid: "Q1" },
    });
  });

  it("goes on with the first work the catalog holds that is not finished", () => {
    const progress = new Map<string, SagaProgress>([
      ["m-manga", { status: "completed", progress: 10, total: 10 }],
    ]);

    expect(startHint(ordered, progress)).toMatchObject({
      kind: "next",
      member: { qid: "Q2" },
    });
  });

  it("says nothing when every work held is finished, or there are no works", () => {
    const done = new Map<string, SagaProgress>(
      ["m-manga", "m-anime", "m-film"].map((id) => [
        id,
        { status: "completed", progress: 1, total: 1 },
      ]),
    );

    expect(startHint(ordered, done)).toBeNull();
    expect(startHint([], new Map())).toBeNull();
  });
});

describe("groupMembers", () => {
  it("groups by format in a fixed order, keeping the order given inside a group", () => {
    const groups = groupMembers(
      orderMembers(members, "release"),
      "es",
      new Map(),
    );

    expect(groups.map((group) => group.format)).toEqual([
      "anime",
      "movie",
      "manga",
      "game",
    ]);
  });

  it("links a work the catalog holds and leaves the rest as text, with the person's entry", () => {
    const progress = new Map<string, SagaProgress>([
      ["m-anime", { status: "in_progress", progress: 5, total: 10 }],
    ]);

    const groups = groupMembers(members, "es", progress);
    const anime = groups.find((group) => group.format === "anime")?.items[0];
    const game = groups.find((group) => group.format === "game")?.items[0];

    expect(anime).toMatchObject({
      label: "El anime",
      href: "/media/anime/el-anime-m-anime",
      entry: { status: "in_progress", percent: 50 },
    });
    expect(game).toMatchObject({ label: "The game", href: null, entry: null });
  });

  it("names a work in the other language when it has none in this one, and leaves out one with no name", () => {
    const groups = groupMembers(
      [
        member({ qid: "Q1", labels: { en: "Only English" } }),
        member({ qid: "Q2", labels: {} }),
      ],
      "es",
      new Map(),
    );

    expect(groups).toEqual([
      {
        format: "anime",
        items: [
          {
            qid: "Q1",
            label: "Only English",
            year: null,
            href: null,
            entry: null,
          },
        ],
      },
    ]);
  });
});
