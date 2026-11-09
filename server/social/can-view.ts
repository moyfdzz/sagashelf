/**
 * Who may see what of a person (SAG-21, ADR-031). This is the ONE place where the answer is decided:
 * every loader and query that shows something of another person asks `canView`, so a screen cannot
 * invent its own rule. It is a pure function with no database, so every combination can be tested.
 *
 * A thing has a level, the same three that a profile, a library entry and a list have:
 * - `public`: anybody who is not blocked, signed in or not.
 * - `friends`: friends only. Two people are friends when each follows the other (two rows of
 *   `follows`, computed and never stored).
 * - `private`: the owner only. Not even a friend sees it.
 *
 * A profile of the level `friends` is **locked, not hidden**: anybody who is not blocked sees its card
 * (the username, the name and the picture, and nothing else) and, once requests exist, can ask to
 * follow. A profile of the level `private` shows nobody anything, not even that it exists
 * (`canSeeCard`). That is the choice a person makes with the level.
 *
 * A block hides each person from the other, whatever the level. Nobody is blocked from their own
 * things: the owner is the owner before anything else.
 */

export type Level = "public" | "friends" | "private";

/** How the viewer stands to the owner, from the owner's side of the question. */
export type Relationship =
  /** The viewer is the owner. */
  | "owner"
  /** Each follows the other. */
  | "friend"
  /** The viewer follows the owner, who does not follow back. */
  | "follower"
  /** Signed in, with no follow in either direction that makes them closer. */
  | "stranger"
  /** Nobody is signed in. */
  | "signed_out"
  /** One of them has blocked the other. */
  | "blocked";

export const relationships: readonly Relationship[] = [
  "owner",
  "friend",
  "follower",
  "stranger",
  "signed_out",
  "blocked",
];

export const levels: readonly Level[] = ["public", "friends", "private"];

const strictness: Record<Level, number> = {
  public: 0,
  friends: 1,
  private: 2,
};

/** The stricter of some levels: a public entry of a private profile is as private as the profile. */
export function strictest(first: Level, ...rest: Level[]): Level {
  return [first, ...rest].reduce((a, b) =>
    strictness[b] > strictness[a] ? b : a,
  );
}

/**
 * The relationship from what a statement read about the two people. `viewerId` is the id of the
 * verified session, or null for a visitor. A block in either direction is `blocked`.
 */
export function relationshipOf(facts: {
  viewerId: string | null;
  ownerId: string;
  blocked: boolean;
  viewerFollowsOwner: boolean;
  ownerFollowsViewer: boolean;
}): Relationship {
  if (facts.viewerId === null) return "signed_out";
  if (facts.viewerId === facts.ownerId) return "owner";
  if (facts.blocked) return "blocked";
  if (facts.viewerFollowsOwner && facts.ownerFollowsViewer) return "friend";
  if (facts.viewerFollowsOwner) return "follower";
  return "stranger";
}

/**
 * Whether the viewer may see something. Give it the level of the thing and, when the thing sits
 * inside a profile, the level of the profile too: the stricter of them decides.
 */
export function canView(
  relationship: Relationship,
  level: Level,
  ...within: Level[]
): boolean {
  if (relationship === "blocked") return false;
  if (relationship === "owner") return true;
  switch (strictest(level, ...within)) {
    case "public":
      return true;
    case "friends":
      return relationship === "friend";
    case "private":
      return false;
  }
}

/**
 * Whether the viewer may see the **card** of a profile: the username, the name and the picture.
 * This is all that a locked profile (`friends`) shows to someone who may not see the rest, and it
 * is also what a public profile shows first. A `private` profile has no card for anybody but its
 * owner, and a block hides even the card.
 */
export function canSeeCard(relationship: Relationship, level: Level): boolean {
  if (relationship === "blocked") return false;
  if (relationship === "owner") return true;
  return level !== "private";
}

/**
 * Whether a profile of this level may be followed straight away: one that a stranger sees in full
 * (today, a public one). A `friends` profile is asked for (`canRequest`) and a `private` one cannot
 * be followed at all (SAG-178). Derived from `canView`, so a new level cannot change one rule and
 * leave the others. A block, the viewer themself and erased accounts are the statement's business.
 */
export function canFollow(level: Level): boolean {
  return canView("stranger", level);
}

/**
 * Whether a profile of this level may be asked for a follow: a locked one, whose card a stranger
 * sees but not the rest (today, a `friends` one) (SAG-178).
 */
export function canRequest(level: Level): boolean {
  return canSeeCard("stranger", level) && !canView("stranger", level);
}
