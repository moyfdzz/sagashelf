# ADR-053: Reviews: length, visibility and the anti-abuse numbers

- **Status:** Accepted
- **Date:** 2026-11-20
- **Implementation:** Done (SAG-22): reviews, their rules and the feed event, then reports on a review ([ADR-057](057-review-reports.md))
- **Tickets:** SAG-22, SAG-270

## Context

SAG-22 adds reviews of a title, the first text that one person writes for others to read on a title page and in a feed. Text that others read is what spam and abuse aim at, and the ticket asked for the exact numbers to be decided with the owner and written down before the code. Three facts shaped the numbers:

- The rate limiter of Cloudflare that every write uses (`WRITE_LIMITER`, 30 a minute per person) only accepts windows of 10 or 60 seconds (`simple.period` in `wrangler.jsonc`). A limit per hour or per day must be counted in Postgres.
- SagaShelf is small: a barrier that is too high leaves the reviews empty, and every filter added here is a rule to test on phone width, in both languages, and against the real Postgres.
- Reports and the moderation panel already exist ([ADR-040](040-warn-suspend-ban.md) to [ADR-043](043-report-again-after-an-answer.md)); a review becomes one more kind of report.

## Decision

Decided with the owner on 2026-11-20.

**What a review is**

- **Length: 500 to 5000 characters**, plain text, line breaks kept. The minimum asks for a few sentences with substance (and turns away "great 10/10"); the maximum is about 800 words. The feed and the title page show an excerpt with "see more". The owner first asked for 1000, then 2000 as the minimum and 10 000 as the maximum; after the risk of padding was explained, the numbers settled on 500 and 5000.
- **One review per person and title**, which its author can edit and delete.
- **Only for a title in the library, started:** the entry must be in progress, paused, completed or dropped (a review of why a title was dropped is useful). With a planned title or none, the page says to mark it in progress first. A review stays if the status goes back to planned later.
- **The score is the one of the library entry:** the review form shows and edits it, so a title never has two scores of the same person.
- **Spoilers:** a checkbox of the author. Readers see a warning and a button to show the text anyway, in the feed and on the title page, usable with the keyboard and a screen reader.
- **Visibility of its own:** public, friends or private, independent of the library entry (the form warns when the entry is more private, since a public review tells that the person has the title). The default is the level of the profile. A profile with total privacy (`private`) can write reviews, but only its author sees them while the profile stays at that level: a public review would tell that the account exists. A profile of the level friends is locked, not hidden ([ADR-031](031-social-graph.md)), so its public reviews show with its card.
- **Removing the title** from the library deletes its review and the likes of the review, and the warning says so.
- **A new review is an activity event** (a new kind `reviewed`), with an excerpt that is hidden when it has spoilers.

**Anti-abuse**

- **New accounts:** a review written in the first **24 hours** of an account is seen only by its author until the account is 24 hours old, then it shows by itself. The author is not stopped from writing.
- **Links: none.** A text with something that looks like an address is refused with a message that says why.
- **Duplicate text:** a review is refused when its normalized text (lowercase, spaces and punctuation collapsed) is the same as another review of the **same person** on another title.
- **Rate:** at most **10 new reviews an hour** per person, counted in Postgres. An edit does not count. Likes use the existing `WRITE_LIMITER` (30 a minute).
- **Export and import:** the reviews go in the full copy of "My data". Buttons of their own to export and import reviews are SAG-270; an imported review must pass the same rules and never appear in the feed.

## Alternatives considered

- **No minimum, or a minimum of 2000 characters.** Without a minimum, one-word reviews fill the page. With 2000 (about 300 words), many honest and thought-out opinions could not be published, and a person who wants to reach the number pads the text, which is worse than a short review and harder to detect.
- **Blocking reviews in the first 24 hours.** Simpler, but a bad first impression for a person who arrives in good faith; hiding them until the account is a day old stops throwaway accounts just as well.
- **One or two links.** Most review spam is links, and a short review rarely needs one.
- **Duplicates across all people.** It catches networks of accounts, but would refuse legitimate short texts that two people happen to write alike.
- **A Cloudflare limiter per hour.** It does not exist: the binding only takes 10 or 60 seconds.
- **The review takes the level of the entry and the profile.** Coherent, but the owner wants a person with a locked profile to be able to talk about a title in public without opening the whole profile.
- **Parts of the text marked as spoilers (`||text||`).** More precise, but it breaks "plain text only" and is harder to make accessible.

## Consequences

- A review needs a table with its own level, which every reader checks with `canView` against the current level of the profile (total privacy hides everything), and which the erasure and the export cover.
- The count of reviews per hour and the duplicate check are each one query in the statement that writes the review; both need an index on the reviews of a person.
- The numbers are constants in one place: changing one later is a one-line change and a note here.

## Open questions

- Whether a review shows the episode or chapter the person was at when they wrote it (useful for a review of a title in progress). Not for now (owner, 2026-11-20): it can be added later without a risky change to the table.

## Notes from the implementation (2026-11-20)

- The likes of a review, the order of the title page and who may like a review are in [ADR-056](056-review-likes-and-order.md).
- The hourly limit is a counter in the row of the person (`users.reviews_hour_start` and `reviews_hour_count`), taken in the statement that writes a new review: a deleted review is still counted, so deleting and writing again cannot get past it (found by the review of the pull request). The hour starts at the first review of the window, so it is a window of one hour that opens with the first review, not a sliding one.
- An edit of a review needs no started entry: a review stays, editable, when the title goes back to planned.
- A link is something that looks like an address: a scheme (`https://`), `www.`, or a name followed by a common ending in lowercase or uppercase (`.com`, `.net`, `.mx` and others, `hasLink` in `server/reviews/rules.ts`). The endings that are common words (`es`, `me`, `co`, `us`, `ar`) are left out, so a sentence that starts right after a period with no space ("mucho.Es una serie") is not taken for one. "Dr. Stone" or "3.5" are not links either.

## References

- `wrangler.jsonc`, the `ratelimits` bindings (`simple.period` of 10 or 60 seconds), read on 2026-11-20.
- SAG-22 and its comments of 2026-11-20 (private ticket repository).
