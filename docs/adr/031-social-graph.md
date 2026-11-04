# ADR-031: The social graph: follows, blocks, mutes and one policy for who may see what

- **Status:** Accepted
- **Date:** 2026-11-04
- **Implementation:** Partial. SAG-21 is the server side (the policy, the statements and the queries). SAG-107 is the profile page, the lists of people, the page of blocked and muted people and the legal pages. Search and follow requests are SAG-108, and favorites and lists of titles are SAG-112 and SAG-113.
- **Tickets:** SAG-21, SAG-107, SAG-108, SAG-112, SAG-113, SAG-22
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

**A locked profile shows a card, a private one shows nothing (SAG-107).** The level `friends` means "locked, not hidden": anybody who is not blocked sees the **card** of the profile (the username, the name and the picture) and nothing else, so they can ask to follow once requests exist (SAG-108). `canSeeCard(relationship, level)` is the second rule of the policy, with its own table:

| level     | owner | friend | follower | stranger | signed out | blocked |
| --------- | ----- | ------ | -------- | -------- | ---------- | ------- |
| `public`  | yes   | yes    | yes      | yes      | yes        | no      |
| `friends` | yes   | yes    | yes      | yes      | yes        | no      |
| `private` | yes   | no     | no       | no       | no         | no      |

A `private` profile has no card for anybody but its owner: the answer is the 404 of a username that does not exist, so it still cannot be told apart from one. A person who picks `friends` chooses to be seen as a name and a picture (the settings say it); one who wants no trace picks `private`. `findProfile` returns `full`, `card` or `null`, and for a card it **drops the bio before it leaves the function**, so no page can show it by mistake; the loader of the page reads no counts and no library for a card, and a test asserts that the data holds no bio.

**The profile page (SAG-107).** `/u/:username` is a public page (not a session page: its buttons are plain forms that reload the page, like the button of a title page), `private, no-store` because it depends on who looks, and `noindex`. It shows the head (name, username, picture, bio), the counts that link to the lists, and three sections of the library: watching or reading now, want to watch or read, and completed (12 of each, newest first, how many there are in all). **The filter is in the query** (`getProfileSections`): the levels of entry that `canView` allows for this relationship and this profile level are the only ones read, so an entry the viewer may not see never leaves the database. The notes of an entry are never read, whatever its level, and the score is shown. Paused and dropped titles are not shown. The buttons (follow, unfollow, mute, unmute, block) are an `action` of the same route: the `Origin` check, a body of 1 KB, the per-person rate limit (`social:<id>`), a Zod `strictObject`, and a redirect with a short word (`?notice=`) that the page turns into a message only if it is one of seven known words. Block goes to `/settings/people`, because the profile is gone for the person who blocked.

**The link to the profile (SAG-114).** The account menu, and the panel of the menu on a phone, have "Perfil" first, a plain anchor to `/u/<username>`. The header needs the username, so the root loader reads the three facts of the header in **one** statement (`findHeaderFacts`: the role as a yes or no, the username and the count of unread notifications) where it made two reads before (the role and the count); an erased account has none of them. A link on its own is drawn in the color of the text, semibold, amber under the pointer (`linkClass`); the blue underlined link (`textLinkClass`) is only for a link inside a sentence, and a test lists the files that use it.

**Lists of people are pages of their own** (`/u/:username/followers`, `/following`, `/friends`, 50 a page, `?page=` up to 100). They start with `findViewableProfile`, so a card or a hidden profile gets the same 404.

**A block can be undone** from `/settings/people` (SAG-107): the blocked and the muted, each with its button. It is needed because a blocked person's profile answers 404 to the person who blocked, so the profile page cannot be the place to undo it. The unblock and unmute answer the same for any username, so the form cannot be used to find out who exists.

**Following is allowed only for a public profile, for now.** Following a friends-only or private profile needs a request that its owner accepts (SAG-108), so until then it is refused. `followUser` answers `followed`, `unavailable` or `too_many`.

**No user enumeration.** `unavailable` is the answer for a username that does not exist, an erased account, a private or friends-only profile, oneself, and a block in either direction, so the answer says nothing about which of them it was. Unfollow, block, unblock, mute and unmute answer the same whoever the name belongs to: they do nothing quietly for a name that does not exist. `findViewableProfile` returns `null` for a missing username, an erased account, a block and a profile the viewer may not see: the four look the same, so a page that shows the same 404 for `null` cannot be used to find out who exists, who has blocked whom, or whose profile is private. A person who may not see a profile gets no counts and no lists from it either (`listFollowers`, `listFollowing`, `listFriends` start with `findViewableProfile`).

**Who is on a list follows their own privacy.** A follower with a public profile is listed to anybody who may see the list; one with a friends-only profile only to their friends and to themselves; one with a private profile only to themselves. The owner of the list sees all of it (they know who follows them). Erased accounts and anybody blocked either way with the viewer are left out. A list shows only the username, the display name and the picture. The page size is 50 and the last page that can be asked for is 100, so nobody can page through all the users.

**An anti-spam cap in the statement.** A person can make **60 new follows an hour**. It is read in the same statement that inserts the follow (`recent` counts the follows of the last hour), so it holds for every caller and does not depend on a route remembering to rate limit. The write routes of SAG-107 add the usual per-person rate limit and the `Origin` check on top.

**A mute is only stored** (`mutes`, migration `0021`, additive). It hides nothing and the other person is never told; the activity feed (SAG-22) reads it. It is in the account erasure in both directions (`erasedColumns`, and the test that reads the foreign keys fails without it).

**The export carries what the person did** (`social`): whom they follow, whom they blocked and whom they muted, by username and since when. Never who follows them or who blocked them, and not an erased account. An import ignores the key.

## Alternatives considered

- **`private` visible to friends.** The ticket said "a private profile reveals nothing to non-friends", which can be read that way. It was not done: "private" and "only me" are the same words in the settings, and a level for friends already exists (`friends`). If a person wants friends to see it, they pick `friends`.
- **A message "this profile is private".** More friendly, and a way to learn that a private profile exists. A locked profile is the choice that does show up on purpose; `private` is the one that does not.
- **Letting followers see `friends` things.** It would make a follow, which needs nobody's consent on a public profile, a way to the `friends` level. Friendship needs the other person to follow back, which is what makes it a decision of both.
- **The policy in SQL.** One predicate in every query would be shorter, but it cannot be tested one combination at a time without a database and it is the kind of rule that drifts between queries. The function is pure and the statements that need a filter (the lists) repeat only the rule for a person on a list, which has its own tests.
- **A table of friendships.** A third table that has to be kept equal to the two follows. Computed, it cannot be wrong.
- **A rate limit only in the routes.** Needed too, but a route that forgets it is an open door; the cap in the statement is the one that cannot be forgotten.
- **Answering `not_found` and `forbidden` apart.** Clearer for a person, and a way to learn that a private profile exists. Not done.

## Consequences

- A page that shows a person's things has one place to ask, and a combination that is wrong is one cell of a table to fix, with the cases that say which (87 for `canView`, 22 more for the card).
- Profiles are visible for the first time with SAG-107. Everything in a library is private by default, so a profile shows only its head until a person marks entries as public or for friends.
- A person with a public profile can be followed, and only a public one. Until SAG-108, the other levels cannot gain followers.
- The lists use `OFFSET`, which is fine for 100 pages of 50 and would not be for more; the cap is why it is acceptable.

## Open questions

- Whether an accepted follow request should make the two friends, or only create the follow (the friend would then still see the card until the owner follows back). SAG-108 decides.
- Whether the counts (followers, following, friends) should be hidden from people who may not see the lists. Today they are only asked for after `findViewableProfile`.

## References

- The code: `server/social/can-view.ts`, `server/db/social.ts`, `db/social.integration.test.ts`.
