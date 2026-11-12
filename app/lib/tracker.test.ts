import { describe, expect, it } from "vitest";

import {
  askedNotToBeMeasured,
  createTracker,
  maxEngagedMs,
  pageOf,
  referrerOrigin,
  searchTypeOf,
  utmOf,
  type TrackerEvent,
} from "./tracker";

describe("askedNotToBeMeasured", () => {
  it("honors Do Not Track and Global Privacy Control", () => {
    expect(askedNotToBeMeasured({ doNotTrack: "1" })).toBe(true);
    expect(askedNotToBeMeasured({ globalPrivacyControl: true })).toBe(true);
  });

  it("measures a visitor who did not ask", () => {
    expect(askedNotToBeMeasured({})).toBe(false);
    expect(askedNotToBeMeasured({ doNotTrack: "0" })).toBe(false);
    expect(askedNotToBeMeasured({ doNotTrack: null })).toBe(false);
    expect(askedNotToBeMeasured({ globalPrivacyControl: false })).toBe(false);
  });
});

describe("pageOf", () => {
  it("keeps a path with no parameter as it is", () => {
    expect(pageOf("/", {})).toBe("/");
    expect(pageOf("/search", {})).toBe("/search");
  });

  it("names the parameter instead of keeping the name of a person or the slug of a title", () => {
    expect(pageOf("/u/ana_reads", { username: "ana_reads" })).toBe(
      "/u/:username",
    );
    expect(pageOf("/sagas/ice-age", { slug: "ice-age" })).toBe("/sagas/:slug");
    expect(pageOf("/library/0199a3c2", { mediaId: "0199a3c2" })).toBe(
      "/library/:mediaId",
    );
  });

  it("keeps the values that come from a short list we wrote", () => {
    expect(
      pageOf("/media/movie/some-title", { type: "movie", slug: "some-title" }),
    ).toBe("/media/movie/:slug");
    expect(
      pageOf("/u/ana_reads/followers", {
        username: "ana_reads",
        kind: "followers",
      }),
    ).toBe("/u/:username/followers");
  });

  it("finds a parameter whose value was written with percent codes", () => {
    expect(pageOf("/u/an%C3%A1", { username: "aná" })).toBe("/u/:username");
  });

  it("turns an address nobody wrote a page for into one page", () => {
    expect(pageOf("/wp-admin/setup.php", { "*": "wp-admin/setup.php" })).toBe(
      "/:splat",
    );
    expect(pageOf("/nowhere", { "*": "nowhere" })).toBe("/:splat");
  });

  it("gives nothing for a path the collector would refuse", () => {
    expect(pageOf(`/${"a".repeat(250)}`, {})).toBeNull();
  });
});

describe("utmOf", () => {
  it("reads the three values and only those", () => {
    expect(
      utmOf(
        "?utm_source=newsletter&utm_medium=email&utm_campaign=nov&q=secret",
      ),
    ).toEqual({
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "nov",
    });
  });

  it("leaves out what is missing or empty, and cuts a long value", () => {
    expect(utmOf("")).toEqual({});
    expect(utmOf("?utm_source=%20%20")).toEqual({});
    expect(utmOf(`?utm_source=${"a".repeat(300)}`).utmSource).toHaveLength(100);
  });
});

describe("referrerOrigin", () => {
  it("keeps the site and drops the path and the query", () => {
    expect(
      referrerOrigin("https://www.google.com/search?q=my+secret+title"),
    ).toBe("https://www.google.com");
    expect(referrerOrigin("https://blog.example/private/post?token=1")).toBe(
      "https://blog.example",
    );
  });

  it("is nothing for no referrer, a text that is not an address or an opaque origin", () => {
    expect(referrerOrigin("")).toBeUndefined();
    expect(referrerOrigin("not an address")).toBeUndefined();
    expect(referrerOrigin("data:text/plain,hi")).toBeUndefined();
  });
});

describe("searchTypeOf", () => {
  it("is the type of the search, or all", () => {
    expect(searchTypeOf("?q=naruto&type=anime")).toBe("anime");
    expect(searchTypeOf("?q=naruto")).toBe("all");
    expect(searchTypeOf("?q=naruto&type=something")).toBe("all");
  });

  it("never has the text of the search", () => {
    expect(searchTypeOf("?q=my%20secret%20title&type=manga")).not.toContain(
      "secret",
    );
  });
});

function harness() {
  const events: TrackerEvent[] = [];
  let clock = 0;
  const tracker = createTracker({
    send: (event) => events.push(event),
    now: () => clock,
    origin: "https://sagashelf.app",
  });
  return {
    events,
    tracker,
    wait: (ms: number) => {
      clock += ms;
    },
  };
}

const visit = (page: string, search = "", referrer = "") => ({
  page,
  search,
  referrer,
});

describe("createTracker", () => {
  it("sends a page view with the referrer and the utm values of the first page", () => {
    const { tracker, events } = harness();

    tracker.visit(
      visit("/", "?utm_source=newsletter", "https://www.google.com/"),
      true,
    );

    expect(events).toEqual([
      {
        kind: "pageview",
        path: "/",
        referrer: "https://www.google.com",
        utmSource: "newsletter",
      },
    ]);
  });

  it("says a later page was reached from this site, and reads no utm from it", () => {
    const { tracker, events } = harness();
    tracker.visit(visit("/"), true);

    tracker.visit(
      visit("/sagas", "?utm_source=again", "https://www.google.com/"),
      true,
    );

    expect(events[1]).toEqual({
      kind: "pageview",
      path: "/sagas",
      referrer: "https://sagashelf.app",
    });
  });

  it("leaves the referrer out when the visit came from nowhere", () => {
    const { tracker, events } = harness();
    tracker.visit(visit("/"), true);
    expect(events[0]).toEqual({
      kind: "pageview",
      path: "/",
      referrer: undefined,
    });
  });

  it("sends the time a page was visible when the visitor moves on", () => {
    const { tracker, events, wait } = harness();
    tracker.visit(visit("/"), true);
    wait(5400);

    tracker.visit(visit("/sagas"), true);

    expect(events[1]).toEqual({ kind: "engaged", path: "/", ms: 5400 });
    expect(events[2]).toMatchObject({ kind: "pageview", path: "/sagas" });
  });

  it("counts only the time the tab was visible", () => {
    const { tracker, events, wait } = harness();
    tracker.visit(visit("/"), true);
    wait(2000);
    tracker.hide();
    wait(600_000);
    tracker.show();
    wait(3000);
    tracker.hide();

    const engaged = events.filter((event) => event.kind === "engaged");
    expect(engaged).toEqual([
      { kind: "engaged", path: "/", ms: 2000 },
      { kind: "engaged", path: "/", ms: 3000 },
    ]);
  });

  it("starts no clock for a page opened in a hidden tab", () => {
    const { tracker, events, wait } = harness();
    tracker.visit(visit("/"), false);
    wait(60_000);
    tracker.hide();

    expect(events.filter((event) => event.kind === "engaged")).toEqual([]);

    tracker.show();
    wait(4000);
    tracker.hide();
    expect(events.at(-1)).toEqual({ kind: "engaged", path: "/", ms: 4000 });
  });

  it("sends nothing for under a second, which is a click through", () => {
    const { tracker, events, wait } = harness();
    tracker.visit(visit("/"), true);
    wait(999);
    tracker.hide();

    expect(events.map((event) => event.kind)).toEqual(["pageview"]);
  });

  it("cuts a tab left open all night to the longest the collector takes", () => {
    const { tracker, events, wait } = harness();
    tracker.visit(visit("/"), true);
    wait(20 * 3_600_000);
    tracker.hide();

    expect(events.at(-1)).toEqual({
      kind: "engaged",
      path: "/",
      ms: maxEngagedMs,
    });
  });

  it("does not send the same time twice", () => {
    const { tracker, events, wait } = harness();
    tracker.visit(visit("/"), true);
    wait(3000);
    tracker.hide();
    tracker.hide();

    expect(events.filter((event) => event.kind === "engaged")).toHaveLength(1);
  });

  it("sends a search with its type and the page it was made on, never its text", () => {
    const { tracker, events } = harness();
    tracker.visit(visit("/search"), true);

    tracker.search("?q=my%20secret%20title&type=anime");

    expect(events.at(-1)).toEqual({
      kind: "search",
      path: "/search",
      type: "anime",
    });
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("sends nothing before a page opened", () => {
    const { tracker, events } = harness();

    tracker.search("?q=x");
    tracker.show();
    tracker.hide();

    expect(events).toEqual([]);
  });
});
