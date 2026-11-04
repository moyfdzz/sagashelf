# ADR-032: Follow requests, and the names of the profile levels

- **Status:** Accepted. The 30-day wait and the cancel that leaves a declined request alone are replaced by [ADR-034](034-cancel-a-declined-request.md).
- **Date:** 2026-11-04
- **Implementation:** Done (SAG-108). Searching people is SAG-115.
- **Tickets:** SAG-108, SAG-115
- **Related:** [ADR-031](031-social-graph.md), [ADR-014](014-account-deletion-erases-everything.md), [ADR-030](030-new-episode-alerts.md), [ADR-018](018-personal-library.md)

## Context

After SAG-21 and SAG-107 only a public profile could be followed. A profile with the level `friends` shows its card (username, name and picture) to anybody who is not blocked, and the page promised that asking to follow would come later. Two things were decided with the owner while planning SAG-108:

- What a person picks in the settings is easier to understand as three names about what other people can do, not as the words "friends only" and "private" (which also mean other things for a library entry). In the owner's words: **Public** is that everybody can see your profile; **Private** is that everybody can find you but, on opening your profile, your information is not available and there is a button to send a request, and the profile is seen only after you accept, or when you are friends; **Total privacy** is that only you see your profile and nobody finds you.
- A second layer will come with the activity feed: a setting for who sees a person's activity (everybody, friends, nobody) and a level for each review (everybody, friends, only me). That is not built here.

## Decision

**The levels keep their code values and change their names on the screen.** `public` is **Public**, `friends` is **Private (friends only)** and `private` is **Total privacy**. Nothing changes in the database, in `canView` or in `canSeeCard` (ADR-031); the settings, the page of a profile and the privacy policy use the new names. The names of a library entry (`Solo yo`, `Solo amistades`, `Público`) are a different setting and stay as they were. The code values line up with the levels of the feed to come: `public`, `friends` (only friends) and `private` (only the owner).

**A request is a row of its own** (`follow_requests`, migration `0022`, additive): the requester, the target, `created_at` and `declined_at`, one row per pair, a check against a request to oneself, and a partial index on the pending ones of a target. A request is not a follow: accepting is what creates the follow.

**Who can be asked.** Only a profile with the level `friends` that exists, is not erased, is not the viewer, is not already followed by the viewer and has no block in either direction with the viewer. For a public profile the answer is `unavailable` (it is followed directly); for **Total privacy**, a missing, an erased or a blocked person the answer is the same `unavailable`, so a request reveals nothing about a profile that is hidden. `requestFollow` answers `requested`, `unavailable` or `too_many`.

**Declining tells nobody, and does not let the person insist.** A declined request is not deleted: `declined_at` is set. The owner never sees it again; the requester still sees "Request sent" and can still cancel it, but the cancel leaves a declined row alone. Asking again does nothing until the decline is 30 days old, when the same statement renews it. This is checked in SQL (no job). Ignoring a request tells nobody either.

**The caps.** Requests share the cap of 60 new follows an hour with the follows (the statement counts both), and a person may have at most 100 requests sent (declined ones count, because to them they look sent). Both are in the statements, as the cap of follows is (ADR-031).

**Where the owner answers.** The page of notifications (`/notifications`) has a section at the top with the pending requests: the name, the username as a plain link to the profile (a session page links out with a plain anchor, and draws no picture because its policy is narrow) and the date. The number in the header counts them with the unread notifications, in the same statement (`findHeaderFacts`), so the header still costs one read. No row of `notifications` is written and nothing goes to Discord: the request is the row itself.

**Three answers.**

- **Accept:** the requester follows the owner. The owner gets nothing more, so the requester does not see the content of a Private profile yet: friendship is still two follows.
- **Accept and follow back:** the requester follows the owner, and the owner follows the requester back. If the requester's profile is **Public** the follow is created directly. If it is **Private**, the owner sends them a request, which they have to accept (nobody gets into a Private profile without accepting). If it is **Total privacy** there is nothing to follow, and the button is not drawn. If both asked each other, the request that already exists is left as it is.
- **Decline:** as above.

**A block removes the requests** between the two people in both directions in the same statement that records the block, declined ones included. Following a public profile removes a request that was sent to it before it became public.

**Erasure and export.** `follow_requests` is in `erasedColumns` in both columns (and the test that reads the foreign keys passes only with it). The export carries `social.requestsSent` (every one, declined ones too, since they look sent) and `social.requestsReceived` (only the pending ones, which the person already sees in the app). Usernames of erased accounts are left out.

## Alternatives considered

- **Delete a declined request.** Simpler, and the requester could ask again at once, as many times as they like, to a person who said no. Keeping the row and the 30 days stops that without a job and without telling anybody.
- **Tell the requester they were declined.** Kinder, and a notice that costs the owner a relationship. Not done: the owner said that declining and ignoring tell nobody.
- **Follow back directly even for a Private requester.** One fewer step, and a Private profile would open to somebody who never accepted. Not done.
- **Requests that also make the two friends.** Friends are two follows and need both to decide; accepting makes a follower, and "Accept and follow back" is the way to friendship in one step.
- **A request to a Total privacy profile that is accepted when the owner looks.** It would need the profile to be asked without being found. Not done: Total privacy answers like a missing username.
- **Requests as rows of `notifications`.** They would reuse the inbox, but a notification is read and forgotten after 30 days, and a request is an open question that must stay until it is answered.

## Consequences

- A Private profile can finally gain followers, and its owner decides each time.
- The number in the header can be a request, not only a notification, so the hidden text that a screen reader reads says "pending" and not "unread".
- A declined request lives for 30 days at least. It is a row about a person who said no, in the data of the person who asked, and the privacy policy says so.
- The search for people (SAG-115) can show the cards of Public and Private profiles and nothing of Total privacy, and it sends a Private profile to the same button.

## Open questions

- The feed and its second layer of visibility (SAG-22). The rule proposed for it: the most restrictive of the profile, the activity setting and the level of the item wins, and the activity of a Private or Total privacy profile never goes to the global feed beyond its level. It is not decided yet.
- Whether 30 days is the right wait. It is a constant (`askAgainAfterDays`); nobody has measured how people use it.

## References

No fact of a third party was used. The levels and the rules came from the owner on 2026-11-04.
