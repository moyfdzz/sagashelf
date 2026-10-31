import { describe, expect, it } from "vitest";

import { curatedSagas } from "./curated";

describe("the curated sagas", () => {
  it("has at least 20 sagas, as the ticket asks for the launch", () => {
    expect(curatedSagas.length).toBeGreaterThanOrEqual(20);
  });

  it("gives each saga a slug for its address, a name in both languages and works", () => {
    for (const saga of curatedSagas) {
      expect(saga.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(saga.titles.es.trim()).not.toBe("");
      expect(saga.titles.en.trim()).not.toBe("");
      expect(saga.members.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses each slug once", () => {
    const slugs = curatedSagas.map((saga) => saga.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("lists only Wikidata item ids, and no work twice in a saga", () => {
    for (const saga of curatedSagas) {
      for (const qid of saga.members) expect(qid).toMatch(/^Q[0-9]{1,12}$/);
      expect(new Set(saga.members).size).toBe(saga.members.length);
    }
  });
});
