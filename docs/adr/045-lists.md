# ADR-045: Lists of titles, with a soft limit and the strictest level

- **Status:** Accepted
- **Date:** 2026-11-08
- **Implementation:** Partial (SAG-113: pages of the lists in the first PR; titles in a list and the profile section are planned in the next two PRs of the same ticket)
- **Tickets:** SAG-113
- **Related:** [ADR-031](031-social-graph.md), [ADR-033](033-design-rules.md), [ADR-043](043-report-again-after-an-answer.md)

## Context

The tables `lists` and `list_items` have existed since SAG-9, with a visibility (`public`, `friends`, `private`), the length checks, the erasure with the account and the export. There was no page to use them. The ticket asked for the pages, a limit of lists and titles "decided with the owner", and that a list is shown on the profile to whoever the policy allows. The owner agreed on 2026-11-08 to the recommendations below.

## Decision

**Pages.** `/lists` shows the lists of the person and the form to make one; `/lists/:id` shows one list in a form to change its name, description and visibility, and a red button to delete it, which asks first in a modal (`ConfirmDialog`, SAG-125). Both are pages of the session, never cached and not indexed, and the account menu links to `/lists`. The top bar does not get a link: its width is measured to the pixel (`Navbar`) and a new link would need that measured again.

**A list that is not the person's is a list that is not there.** Every statement in `server/db/lists.ts` has the id of the person of the session in its `WHERE`, and the page answers 404 for a list of someone else, for one that does not exist and for an id that is not an id, the same way. Until the profile section exists (a later PR of SAG-113) nobody but the owner can open a list.

**Private by default.** The form starts on Private, as the table does. The three levels say in the form who sees the list, and the profile can only narrow it: a list is seen by whoever `canView` allows for the **strictest** of the level of the list and the level of the profile (`strictest`, ADR-031). This is written here before the code that applies it (the profile PR). Until then the levels are only stored.

**Limits.** At most **50 lists** per person, **200 titles** per list (the second is built with the titles), a title of 1 to 100 characters and a description of up to 500, counted in characters as the table does (an emoji is one). A title is unique per person (the unique constraint of the table).

**The limit of lists is soft.** The count and the insert are one statement (`createList`), which refuses when the person already has 50. Two forms sent at the very same moment each count before the other inserts and can pass the limit by one or two. The rate limit of the writes makes that rare, an extra list costs nothing, and a lock would add a statement to every creation, so it is accepted. The page reads all the lists of a person, with no `LIMIT`, so one that went over is never hidden.

**The title is checked by the constraint.** `createList` uses `INSERT ... ON CONFLICT DO NOTHING` with no target (ADR-043), and answers "duplicate" when nothing was inserted and the person is under the limit. A form that loses a race for the same title is answered the same way as one that arrives later, and does not fail with a database error. `updateList` refuses a title that another list of the person has inside its statement.

**What is written is given back.** A form that is refused (a title already used, the limit, a name too long) answers with its status and the text that was typed, since the forms post a whole page and 500 characters of description must not be lost for a mistake in the name.

## Alternatives considered

- **A hard limit with a lock** (`SELECT ... FOR UPDATE` on the user row, or a counter column). It is exact, but it adds a statement or a column and a migration to protect against an extra list that costs nothing.
- **No limit.** The table has none, but a person (or a script, past the rate limit) could fill the database with lists; 50 is far above what anybody needs.
- **A link to share with a secret address.** A public list is shared by its normal address. A secret link would be a second way to read a list that bypasses `canView`, and the ticket asks for the policy of the profile.
- **Reordering by dragging.** It needs JavaScript and works badly on a phone. Buttons to move a title up and down, which work without it, come with the titles.
- **A link in the top bar.** It needs the measure of the header redone, for a page that few people open often.

## Consequences

- A person can have lists, name them, describe them and delete them, and nothing is visible to others yet.
- The rest of the ticket (titles, reorder, the buttons on the title page and on the library entry, the section on the profile and on the page of a list for others) is planned in two more PRs. Until the last one the ticket stays In Progress.
- A list that someone deletes goes with its titles (`ON DELETE CASCADE`); nothing else refers to a list yet. `activity` has a kind `list_created` that nothing writes, which belongs to SAG-44.

## Open questions

- Whether a list should ever be shared by a link that works without the profile being visible. Not decided; today the profile limits it.
- The statements run on the Neon driver in production, and were only tried with `pg` locally.

## References

- ADR-031 for `canView` and `strictest`; ADR-033 for the design rules (one statement for a data function, a thin route); ADR-043 for `ON CONFLICT DO NOTHING` with no target.
