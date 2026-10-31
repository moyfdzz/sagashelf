import { describe, expect, it } from "vitest";

import { attackOnTitan, simpsons } from "../../testing/tvmaze";
import { nextCheckAt, parseShow } from "./map";

describe("parseShow", () => {
  it("reads the status and the next episode of a show that has one", () => {
    expect(parseShow(simpsons)).toEqual({
      status: "Running",
      next: {
        airDate: "2026-11-01",
        airStamp: "2026-11-02T01:00:00.000Z",
        season: 38,
        number: 5,
        name: "Testing 1-2-3",
      },
    });
  });

  it("says there is no next episode for a show that is over", () => {
    expect(parseShow(attackOnTitan)).toEqual({ status: "Ended", next: null });
  });

  it("leaves out what does not look right, and never throws", () => {
    const episode = (fields: Record<string, unknown>) => ({
      status: "Running",
      _embedded: { nextepisode: fields },
    });

    // No usable date: there is no next episode to show.
    expect(parseShow(episode({ airdate: "" })).next).toBeNull();
    expect(parseShow(episode({ airdate: "soon" })).next).toBeNull();
    expect(parseShow(episode({ airdate: "2026-11-1" })).next).toBeNull();
    expect(parseShow(episode({ name: "No date" })).next).toBeNull();
    // A date with nothing else is still a date.
    expect(parseShow(episode({ airdate: "2026-11-01" })).next).toEqual({
      airDate: "2026-11-01",
      airStamp: null,
      season: null,
      number: null,
      name: null,
    });
    expect(
      parseShow(
        episode({
          airdate: "2026-11-01",
          airstamp: "not a moment",
          season: -1,
          number: 1.5,
          name: "   ",
        }),
      ).next,
    ).toEqual({
      airDate: "2026-11-01",
      airStamp: null,
      season: null,
      number: null,
      name: null,
    });
    expect(parseShow(null)).toEqual({ status: null, next: null });
    expect(parseShow("nonsense")).toEqual({ status: null, next: null });
    expect(parseShow({ _embedded: { nextepisode: null } }).next).toBeNull();
  });

  it("cuts a name and a status that are too long", () => {
    const show = parseShow({
      status: "x".repeat(100),
      _embedded: {
        nextepisode: { airdate: "2026-11-01", name: "y".repeat(500) },
      },
    });

    expect(show.status).toHaveLength(40);
    expect(show.next?.name).toHaveLength(200);
  });
});

describe("nextCheckAt (SAG-90)", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const hours = (count: number) => count * 60 * 60 * 1000;
  const days = (count: number) => hours(24 * count);
  const withNext = (airDate: string) => ({
    status: "Running",
    next: { airDate, airStamp: null, season: 1, number: 1, name: null },
  });

  it("is the day after the next episode comes out", () => {
    // The episode is on the 4th, so the show is asked about on the 5th at noon.
    expect(nextCheckAt(now, withNext("2026-11-04")).toISOString()).toBe(
      "2026-11-05T12:00:00.000Z",
    );
  });

  it("is never later than a week away, whatever the date of the episode", () => {
    expect(nextCheckAt(now, withNext("2027-03-01")).getTime()).toBe(
      now.getTime() + days(7),
    );
  });

  it("is never sooner than six hours, so a date that has passed is not asked about on every run", () => {
    expect(nextCheckAt(now, withNext("2026-10-01")).getTime()).toBe(
      now.getTime() + hours(6),
    );
    expect(nextCheckAt(now, withNext("2026-11-01")).getTime()).toBe(
      new Date("2026-11-02T12:00:00Z").getTime(),
    );
  });

  it("is a week for a show that is running with no date", () => {
    for (const status of ["Running", "To Be Determined", "In Development"]) {
      expect(nextCheckAt(now, { status, next: null }).getTime()).toBe(
        now.getTime() + days(7),
      );
    }
  });

  it("is three months for a show that is over, one TVmaze does not know and one with no status", () => {
    expect(nextCheckAt(now, { status: "Ended", next: null }).getTime()).toBe(
      now.getTime() + days(90),
    );
    expect(nextCheckAt(now, null).getTime()).toBe(now.getTime() + days(90));
    expect(nextCheckAt(now, { status: null, next: null }).getTime()).toBe(
      now.getTime() + days(90),
    );
  });
});
