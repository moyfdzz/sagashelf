import { describe, expect, it } from "vitest";

import {
  canSeeCard,
  canView,
  levels,
  relationshipOf,
  relationships,
  strictest,
  type Level,
  type Relationship,
} from "./can-view";

/**
 * What each relationship may see of a thing of each level, written out in full. Every cell of the
 * table is one case: 6 relationships × 3 levels.
 */
const expected: Record<Relationship, Record<Level, boolean>> = {
  owner: { public: true, friends: true, private: true },
  friend: { public: true, friends: true, private: false },
  follower: { public: true, friends: false, private: false },
  stranger: { public: true, friends: false, private: false },
  signed_out: { public: true, friends: false, private: false },
  blocked: { public: false, friends: false, private: false },
};

describe("canView (SAG-21): every privacy level × every relationship", () => {
  for (const relationship of relationships) {
    for (const level of levels) {
      it(`${relationship} ${expected[relationship][level] ? "sees" : "does not see"} a ${level} thing`, () => {
        expect(canView(relationship, level)).toBe(
          expected[relationship][level],
        );
      });
    }
  }

  it("covers every relationship and every level that exists", () => {
    expect(Object.keys(expected).sort()).toEqual([...relationships].sort());
    for (const relationship of relationships) {
      expect(Object.keys(expected[relationship]).sort()).toEqual(
        [...levels].sort(),
      );
    }
  });
});

describe("canView: a thing inside a profile takes the stricter level", () => {
  for (const relationship of relationships) {
    for (const item of levels) {
      for (const profile of levels) {
        it(`${relationship}, a ${item} thing in a ${profile} profile`, () => {
          const stricter = strictest(item, profile);

          expect(canView(relationship, item, profile)).toBe(
            expected[relationship][stricter],
          );
        });
      }
    }
  }

  it("makes a public entry of a private profile as private as the profile", () => {
    expect(canView("friend", "public", "private")).toBe(false);
    expect(canView("stranger", "public", "private")).toBe(false);
    expect(canView("signed_out", "public", "private")).toBe(false);
  });

  it("makes a private entry of a public profile as private as the entry", () => {
    expect(canView("friend", "private", "public")).toBe(false);
    expect(canView("owner", "private", "public")).toBe(true);
  });
});

describe("canView: the rules that must never break", () => {
  it("never shows anything to a blocked person, whatever the level", () => {
    for (const level of levels) {
      expect(canView("blocked", level)).toBe(false);
      expect(canView("blocked", level, "public")).toBe(false);
    }
  });

  it("always shows everything to the owner, even through a stricter profile", () => {
    for (const level of levels) {
      for (const within of levels) {
        expect(canView("owner", level, within)).toBe(true);
      }
    }
  });

  it("shows a private thing to nobody but the owner", () => {
    for (const relationship of relationships) {
      expect(canView(relationship, "private")).toBe(relationship === "owner");
    }
  });

  it("shows a friends-only thing to nobody but friends and the owner", () => {
    for (const relationship of relationships) {
      expect(canView(relationship, "friends")).toBe(
        relationship === "friend" || relationship === "owner",
      );
    }
  });

  it("is more generous never than the strictest level it is given", () => {
    for (const relationship of relationships) {
      for (const level of levels) {
        for (const within of levels) {
          if (canView(relationship, level, within)) {
            expect(canView(relationship, level)).toBe(true);
            expect(canView(relationship, within)).toBe(true);
          }
        }
      }
    }
  });
});

describe("strictest", () => {
  it("picks private over friends over public", () => {
    expect(strictest("public")).toBe("public");
    expect(strictest("public", "friends")).toBe("friends");
    expect(strictest("friends", "private", "public")).toBe("private");
    expect(strictest("private", "friends")).toBe("private");
  });
});

describe("relationshipOf", () => {
  const owner = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
  const viewer = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";
  const facts = (overrides: Partial<Parameters<typeof relationshipOf>[0]>) => ({
    viewerId: viewer,
    ownerId: owner,
    blocked: false,
    viewerFollowsOwner: false,
    ownerFollowsViewer: false,
    ...overrides,
  });

  it("is signed_out for a visitor, whatever else is true", () => {
    expect(
      relationshipOf(
        facts({ viewerId: null, viewerFollowsOwner: true, blocked: true }),
      ),
    ).toBe("signed_out");
  });

  it("is owner when the viewer is the owner, before a block is even looked at", () => {
    expect(relationshipOf(facts({ viewerId: owner, blocked: true }))).toBe(
      "owner",
    );
  });

  it("is blocked when either has blocked the other, even if they follow each other", () => {
    expect(
      relationshipOf(
        facts({
          blocked: true,
          viewerFollowsOwner: true,
          ownerFollowsViewer: true,
        }),
      ),
    ).toBe("blocked");
  });

  it("is friend only when each follows the other", () => {
    expect(
      relationshipOf(
        facts({ viewerFollowsOwner: true, ownerFollowsViewer: true }),
      ),
    ).toBe("friend");
  });

  it("is follower when only the viewer follows the owner", () => {
    expect(relationshipOf(facts({ viewerFollowsOwner: true }))).toBe(
      "follower",
    );
  });

  it("is stranger when only the owner follows the viewer, or nobody follows", () => {
    expect(relationshipOf(facts({ ownerFollowsViewer: true }))).toBe(
      "stranger",
    );
    expect(relationshipOf(facts({}))).toBe("stranger");
  });
});

/** Who sees the card of a profile (SAG-107): written out in full, 6 relationships × 3 levels. */
const cardExpected: Record<Relationship, Record<Level, boolean>> = {
  owner: { public: true, friends: true, private: true },
  friend: { public: true, friends: true, private: false },
  follower: { public: true, friends: true, private: false },
  stranger: { public: true, friends: true, private: false },
  signed_out: { public: true, friends: true, private: false },
  blocked: { public: false, friends: false, private: false },
};

describe("canSeeCard (SAG-107): every privacy level × every relationship", () => {
  for (const relationship of relationships) {
    for (const level of levels) {
      it(`${relationship} ${cardExpected[relationship][level] ? "sees" : "does not see"} the card of a ${level} profile`, () => {
        expect(canSeeCard(relationship, level)).toBe(
          cardExpected[relationship][level],
        );
      });
    }
  }

  it("is never more than the profile itself shows to the owner, and never to a blocked person", () => {
    for (const level of levels) {
      expect(canSeeCard("owner", level)).toBe(true);
      expect(canSeeCard("blocked", level)).toBe(false);
    }
  });

  it("is what a locked profile shows to anybody who may not see the rest", () => {
    for (const relationship of [
      "follower",
      "stranger",
      "signed_out",
    ] as const) {
      expect(canView(relationship, "friends")).toBe(false);
      expect(canSeeCard(relationship, "friends")).toBe(true);
    }
  });

  it("never gives a card to somebody who may not even know the profile exists: a private one", () => {
    for (const relationship of relationships) {
      expect(canSeeCard(relationship, "private")).toBe(
        relationship === "owner",
      );
    }
  });

  it("is never stricter than the full view: whoever sees everything sees the card", () => {
    for (const relationship of relationships) {
      for (const level of levels) {
        if (canView(relationship, level)) {
          expect(canSeeCard(relationship, level)).toBe(true);
        }
      }
    }
  });
});
