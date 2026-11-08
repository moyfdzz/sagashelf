import { describe, expect, it } from "vitest";

import { visibleListLevels } from "./profile-lists";

/**
 * The levels of list a viewer may see on a profile: the strictest of the list and the profile
 * decides (ADR-045). The expected rows are written by hand, not asked of `canView`.
 */
describe("visibleListLevels", () => {
  it.each([
    ["owner", "public", ["public", "friends", "private"]],
    ["owner", "friends", ["public", "friends", "private"]],
    ["friend", "public", ["public", "friends"]],
    ["friend", "friends", ["public", "friends"]],
    ["follower", "public", ["public"]],
    ["stranger", "public", ["public"]],
    ["signed_out", "public", ["public"]],
    // A profile that is only for friends narrows every list to what friends may see.
    ["follower", "friends", []],
    ["stranger", "friends", []],
    // A private profile shows nothing of its lists to anybody but the owner.
    ["friend", "private", []],
    ["stranger", "private", []],
    // A block hides everything, even from a person who would otherwise be a friend.
    ["blocked", "public", []],
    ["blocked", "friends", []],
  ] as const)(
    "gives a %s of a %s profile the levels %j",
    (relationship, profileLevel, expected) => {
      expect(visibleListLevels(relationship, profileLevel)).toEqual(expected);
    },
  );
});
