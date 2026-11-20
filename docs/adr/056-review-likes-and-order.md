# ADR-056: A review carries its likes on its feed event, and the title page orders reviews by them

- **Status:** Accepted
- **Date:** 2026-11-20
- **Implementation:** Done (SAG-22, the pull request of reviews)
- **Tickets:** SAG-22

## Context

[ADR-053](053-review-anti-abuse.md) decided what a review is and that a new one is an activity event (`reviewed`). [ADR-055](055-feed-and-likes.md) decided that a like is a like of an event, written only on an event the feed shows to that person, and that only the count is shown. Two things were left open when the reviews were built:

- **The order of the reviews on a title page.** The first proposal was the newest first. The owner asked for the most relevant first, measured by likes.
- **Who can like a review.** With the rule of ADR-055 only the followers of the author could like a review (the feed only shows the people a person follows). Ordering by likes would then always favor authors with many followers, and a review by somebody nobody follows could never rise.

## Decision

Decided with the owner on 2026-11-20.

- **A review's likes are the likes of its `reviewed` event.** The review stores the id of its event (`reviews.activity_id`), written in the same statement as the review with an id the caller makes, so a review and its event always exist together. The foreign key has no action on delete: a statement that deleted the event and left the review fails. Deleting a review, removing the title from the library and erasing the account delete both in one statement, and the likes go with the event.
- **A like can be given from the title page** by anybody who may see the review there, follower or not. `setLike` writes a like on an event of `likeableEvents` (`server/db/feed.ts`): the events the feed shows the person (ADR-055) plus the events of the reviews the title page shows them (`reviewShown` in `server/db/reviews.ts`). One count, the same in the feed and on the title page, and still never on the person's own event. The export of the likes reads the title through the same set.
- **Who sees a review on the title page** (`reviewShown`): its author always; anybody else when the review was not removed by a moderator, the author is not erased and their account is a day old, there is no block either way and the viewer did not mute the author, and the level of the review allows it (its own level, or private when the profile has Total privacy; a locked profile still shows its public reviews). Read through the current library entry of the title, like the feed. A visitor sees the public ones.
- **Order.** The viewer's own review first. Then, by default, **most relevant**: the most likes, ties by the newest. A switch shows the **newest** first. Ten a page with links to the next and previous pages (`?reviews=recent&reviewsPage=2`), so it works without JavaScript; a page past 100 or a made-up order falls back to the first page.
- **The score** shown on a review is the one of the author's library entry, and only where that entry would show (the stricter of the entry and the profile), since a review may be more open than the entry.
- **A `reviewed` event in the feed** shows at the level of its review, not of the entry, and only while the review exists; to others only while it was not removed and the account is a day old. The feed reads only the start of the text. Editing a review writes no new event: the event keeps its time and only its stored level follows the review.
- **Muting** hides the reviews of the muted person on title pages too, not only in the feed.

## Alternatives considered

- **Only the newest first.** Simplest and fair to new reviews, but the owner wants the useful ones to rise. The switch to "newest" keeps new reviews reachable.
- **Ordering by likes with likes only from followers.** No change to ADR-055, but the order would measure how many followers the author has, not how good the review is.
- **A table of likes of reviews of its own.** A clean separation, but two counts for one review (the feed and the title page) and a second set of rules for who may like.
- **Joining the event by person, title and kind instead of storing its id.** No new column, but nothing would stop two `reviewed` events for one review, and the like of a deleted and rewritten review could land on the new one.
- **A score of relevance mixing likes and age.** Better for a big site; at this scale the plain count with ties by date is easy to explain and to test.
- **Loading more reviews in place ("load more" with JavaScript).** Nicer, but a new resource route and a form that does not work without JavaScript; the page links are enough for now.

## Consequences

- The count of likes can change between two pages, so a review can repeat or be skipped at the edge of a page. Each page is read on its own, which is fine at this scale.
- The like of a review works for strangers, so it is limited like every like (the `WRITE_LIMITER`, 30 a minute) and answers the same 404 for anything the person may not see.
- A new reader of reviews goes through `reviewShown`; the second pull request of SAG-22 (reports on a review) sets `removed_at`, which every reader already checks.
- `db/reviews.integration.test.ts` holds the table of who sees a review, written by hand from ADR-031 and ADR-053.

## References

- [ADR-031](031-social-graph.md), [ADR-053](053-review-anti-abuse.md), [ADR-055](055-feed-and-likes.md).
- SAG-22 and the decisions of 2026-11-20 (private ticket repository).
