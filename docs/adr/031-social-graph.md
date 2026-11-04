# ADR-031: The social graph: follows, blocks, mutes and one policy for who may see what

- **Status:** Accepted
- **Date:** 2026-11-04
- **Implementation:** Partial (SAG-21): the server side only (the policy, the statements and the queries, with their tests). There is no page and no route yet: the public profile is SAG-107, and search and follow requests are SAG-108.
- **Tickets:** SAG-21, SAG-107, SAG-108, SAG-22
- **Related:** [ADR-003](003-auth-clerk.md), [ADR-006](006-security-model.md), [ADR-014](014-account-deletion-erases-everything.md), [ADR-018](018-personal-library.md)

## Context

The tables `follows` and `blocks` existed from SAG-9, and a profile, a library entry and a list each had a level (`public`, `friends`, `private`) that nothing read for another person. SAG-21 asked for the social graph and for "authorization in one place", with a profile that reveals nothing to those who may not see it. The ticket is large and touches who sees what, so it was split: this one is the server side, and the pages come after it, built on top of it.

## Decision

**One policy, a pure function** (`server/social/can-view.ts`). `canView(relationship, level, ...within)` says whether a viewer may see a thing of a level, and when the thing sits inside a profile the stricter level of the two decides (a public entry of a private profile is as private as the profile). The relationships are `owner`, `friend`, `follower`, `stranger`, `signed_out` and `blocked`:

| level     | owner | friend | follower | stranger | signed out | blocked |
| --------- | ----- | ------ | -------- | -------- | ---------- | ------- |
| `public`  | yes   | yes    | yes      | yes      | yes        | no      |
| `friends` | yes   | yes    | no       | no       | no         | no      |
| `private` | yes   | no     | no       | no       | no         | no      |

**`private` means the owner only**, as the settings already say ("Solo yo" for an entry, "Privado" for a profile). A friend does not see it. A **follower** (the viewer follows, the owner does not follow back) sees what a stranger sees: following gives no access, only friendship does, and **friends are two follows, computed and never stored**. A **block** in either direction hides everything, and it is decided before anything but the owner. The relationship comes from three facts read in one statement (`getRelationship`): is there a block in either direction, does the viewer follow the owner, does the owner follow the viewer. The function that turns them into a relationship is also pure (`relationshipOf`).

**Every statement is one statement, with the id of the session.** `follows`, `blocks` and the new `mutes` are written only by `server/db/social.ts`, each function being one SQL statement (atomic on the HTTP client, ADR-029), taking `viewerId` from the verified session and naming the other person by **username** (`citext`, so any case). Blocking inserts the block and deletes the follows in both directions in the same statement. Unblocking does not bring the follows back.

**Following is allowed only for a public profile, for now.** Following a friends-only or private profile needs a request that its owner accepts (SAG-108), so until then it is refused. `followUser` answers `followed`, `unavailable` or `too_many`.

**No user enumeration.** `unavailable` is the answer for a username that does not exist, an erased account, a private or friends-only profile, oneself, and a block in either direction, so the answer says nothing about which of them it was. Unfollow, block, unblock, mute and unmute answer the same whoever the name belongs to: they do nothing quietly for a name that does not exist. `findViewableProfile` returns `null` for a missing username, an erased account, a block and a profile the viewer may not see: the four look the same, so a page that shows the same 404 for `null` cannot be used to find out who exists, who has blocked whom, or whose profile is private. A person who may not see a profile gets no counts and no lists from it either (`listFollowers`, `listFollowing`, `listFriends` start with `findViewableProfile`).

**Who is on a list follows their own privacy.** A follower with a public profile is listed to anybody who may see the list; one with a friends-only profile only to their friends and to themselves; one with a private profile only to themselves. The owner of the list sees all of it (they know who follows them). Erased accounts and anybody blocked either way with the viewer are left out. A list shows only the username, the display name and the picture. The page size is 50 and the last page that can be asked for is 100, so nobody can page through all the users.

**An anti-spam cap in the statement.** A person can make **60 new follows an hour**. It is read in the same statement that inserts the follow (`recent` counts the follows of the last hour), so it holds for every caller and does not depend on a route remembering to rate limit. The write routes of SAG-107 add the usual per-person rate limit and the `Origin` check on top.

**A mute is only stored** (`mutes`, migration `0021`, additive). It hides nothing and the other person is never told; the activity feed (SAG-22) reads it. It is in the account erasure in both directions (`erasedColumns`, and the test that reads the foreign keys fails without it).

**The export carries what the person did** (`social`): whom they follow, whom they blocked and whom they muted, by username and since when. Never who follows them or who blocked them, and not an erased account. An import ignores the key.

## Alternatives considered

- **`private` visible to friends.** The ticket said "a private profile reveals nothing to non-friends", which can be read that way. It was not done: "private" and "only me" are the same words in the settings, and a level for friends already exists (`friends`). If a person wants friends to see it, they pick `friends`.
- **Letting followers see `friends` things.** It would make a follow, which needs nobody's consent on a public profile, a way to the `friends` level. Friendship needs the other person to follow back, which is what makes it a decision of both.
- **The policy in SQL.** One predicate in every query would be shorter, but it cannot be tested one combination at a time without a database and it is the kind of rule that drifts between queries. The function is pure and the statements that need a filter (the lists) repeat only the rule for a person on a list, which has its own tests.
- **A table of friendships.** A third table that has to be kept equal to the two follows. Computed, it cannot be wrong.
- **A rate limit only in the routes.** Needed too, but a route that forgets it is an open door; the cap in the statement is the one that cannot be forgotten.
- **Answering `not_found` and `forbidden` apart.** Clearer for a person, and a way to learn that a private profile exists. Not done.

## Consequences

- A page that shows a person's things has one place to ask, and a combination that is wrong is one cell of a table to fix, with 87 cases that say which.
- There is nothing to see yet: this ticket changes no page, so it changes nothing in production but one empty table (`mutes`) and the export.
- A person with a public profile can be followed, and only a public one. Until SAG-108, the other levels cannot gain followers.
- The lists use `OFFSET`, which is fine for 100 pages of 50 and would not be for more; the cap is why it is acceptable.

## Open questions

- What a person with a `friends` profile shows to a `follower` who is not a friend is "nothing", by this ADR. SAG-107 may want to show that the profile exists and is friends-only; that would be a different, deliberate leak and needs its own decision.
- Whether the counts (followers, following, friends) should be hidden from people who may not see the lists. Today they are only asked for after `findViewableProfile`.

## References

- The code: `server/social/can-view.ts`, `server/db/social.ts`, `db/social.integration.test.ts`.
