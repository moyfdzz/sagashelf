# ADR-045: Lists of titles, with a soft limit and the strictest level

- **Status:** Accepted
- **Date:** 2026-11-08
- **Implementation:** Complete (SAG-113: pages of the lists and the titles in a list in the first PRs; the profile section and the page of a list for others in the last one)
- **Tickets:** SAG-113
- **Related:** [ADR-031](031-social-graph.md), [ADR-033](033-design-rules.md), [ADR-043](043-report-again-after-an-answer.md)

## Context

The tables `lists` and `list_items` have existed since SAG-9, with a visibility (`public`, `friends`, `private`), the length checks, the erasure with the account and the export. There was no page to use them. The ticket asked for the pages, a limit of lists and titles "decided with the owner", and that a list is shown on the profile to whoever the policy allows. The owner agreed on 2026-11-08 to the recommendations below.

## Decision

**Pages.** `/lists` only shows the lists of the person, with a button "Crear lista" and, on each list, two icon buttons: change it and delete it. `/lists/new` is the form to make one, on a page of its own so that reading and making are not on the same page (changed on 2026-11-08, after the owner tried the first version). `/lists/:id` shows one list in a form to change its name, description and visibility, and a red button to delete it. Every delete asks first in a modal (`ConfirmDialog`, SAG-125) that names the list; the one of `/lists` posts to the delete of `/lists/:id`, so the server has one delete. All three are pages of the session, never cached and not indexed. The account menu links to `/lists`, and so does the library, next to its title. The top bar does not get a link: its width is measured to the pixel (`Navbar`) and a new link would need that measured again. The two icon buttons are 32 px, smaller than the 40 px of the buttons with text, by the choice of the owner; WCAG 2.2 asks for 24 px (success criterion 2.5.8).

**Titles in a list.** The page of a list shows its titles in the order the person chose (`position`, then `created_at`, then the id, so the titles of a list that share a position have a clear order). Each has a link to its page, three forms (move up or down, remove, save a note) and the buttons are 40 px, since they are pressed in a column on a phone. The up button of the first title and the down button of the last are off. Every form is a plain form that posts to the page of the list and ends in a redirect with `?notice=` (`removed`, `moved`, `note_saved`) and `#titles`. A move swaps a title with its neighbour in **one statement** that numbers the whole list again from 0, so it needs no lock, is the same for the old rows that all have position 0 and writes nothing at an end. A note is private to the owner and is never shown to others, as the notes of the library. The button "Add to a list" is on the page of a title and on the entry of the library: a `<select>` of the lists that do not have the title and a button, posting to `/lists/add` (a resource route). With JavaScript it is a fetcher and the result shows in the toast; without it the person goes back to the page they came from, with no message. The lists that already have the title are named under the button. Any title of the catalog can be added; a title a person made for themselves (`custom`) only to their own lists, and a custom title of someone else is answered as one that does not exist.

**The limit of titles is soft too.** The count, the ownership, the existence of the title and the insert are one statement (`addListItem`): at 200 it inserts nothing and the answer is "limit", and a title already in the list is "already" (`ON CONFLICT DO NOTHING` with no target, ADR-043). Two forms at the very same moment can pass 200 by one or two, for the same reasons as the lists.

**A list that is not the person's is a list that is not there.** Every statement in `server/db/lists.ts` has the id of the person of the session in its `WHERE`, and the page answers 404 for a list of someone else, for one that does not exist and for an id that is not an id, the same way. `/lists/:id` stays the page of the owner only. Others read a list on `/u/:username/lists/:id` (see "Lists for others"). The same holds for its titles: every statement of `server/db/list-items.ts` joins the list to the id of the person of the session, so the id of a title of a list of someone else is not enough to read, move, note or remove it.

**Private by default.** The form starts on Private, as the table does. The three levels say in the form who sees the list, and the profile can only narrow it: a list is seen by whoever `canView` allows for the **strictest** of the level of the list and the level of the profile (`strictest`, ADR-031). The code that applies it is in "Lists for others".

**Limits.** At most **50 lists** per person, **200 titles** per list (the second is built with the titles), a title of 1 to 100 characters and a description of up to 500, counted in characters as the table does (an emoji is one). A title is unique per person (the unique constraint of the table).

**The limit of lists is soft.** The count and the insert are one statement (`createList`), which refuses when the person already has 50. Two forms sent at the very same moment each count before the other inserts and can pass the limit by one or two. The rate limit of the writes makes that rare, an extra list costs nothing, and a lock would add a statement to every creation, so it is accepted. The page reads all the lists of a person, with no `LIMIT`, so one that went over is never hidden.

**The title is checked by the constraint.** `createList` uses `INSERT ... ON CONFLICT DO NOTHING` with no target (ADR-043), and answers "duplicate" when nothing was inserted and the person is under the limit. A form that loses a race for the same title is answered the same way as one that arrives later, and does not fail with a database error. `updateList` refuses a title that another list of the person has inside its statement.

**What is written is given back.** A form that is refused (a title already used, the limit, a name too long) answers with its status and the text that was typed, since the forms post a whole page and 500 characters of description must not be lost for a mistake in the name.

**Lists for others.** The profile shows a section "Listas" with the lists the viewer may see, and each one opens on `/u/:username/lists/:id`. It is a page of its own, not `/lists/:id`, because `/lists/:id` is a page of the session with Clerk and forms (ADR-018), and the pages under `/u/...` are not: they read the viewer with `getOptionalUser`, so a visitor can read a public list, and a read-only page has no reason to carry the session. Every function of `server/db/profile-lists.ts` takes who is looking and the level of the profile, never a list of levels, and works the levels out inside with `visibleListLevels` (`canView` for each level with the level of the profile), so a route cannot forget them or pass too many (SAG-163). Every statement has them in its `WHERE`: a list above them is the same as a list that is not there, and its titles are read only through the same filter. The list and its titles are asked for together, since a list the viewer may not see gives no titles either. The page answers one 404 for a profile that may not be seen, a bad username or id, a list of someone else, a list above the levels and a block, so it cannot be used to find out who exists or who has what. The note of a title is not read at all. The owner who opens it on this address sees the same read-only page with a link to edit it.

## Alternatives considered

- **A hard limit with a lock** (`SELECT ... FOR UPDATE` on the user row, or a counter column). It is exact, but it adds a statement or a column and a migration to protect against an extra list that costs nothing.
- **No limit.** The table has none, but a person (or a script, past the rate limit) could fill the database with lists; 50 is far above what anybody needs.
- **A link to share with a secret address.** A public list is shared by its normal address. A secret link would be a second way to read a list that bypasses `canView`, and the ticket asks for the policy of the profile.
- **Reordering by dragging.** It needs JavaScript and works badly on a phone. Buttons to move a title up and down work without it, and they are what was built.
- **A modal to choose the list.** More code and more to get right for a screen reader than a `<select>`, for a choice among at most 50 names.
- **A second use of `/lists/:id` for others, with the session optional.** It would mix a page of the session with a public one, and the edit page would depend on a branch that is easy to get wrong.
- **A link in the top bar.** It needs the measure of the header redone, for a page that few people open often.

## Consequences

- A person can have lists, name them, describe them and delete them, and nothing is visible to others yet.
- A person can fill a list: add, remove, reorder and note titles. Others see it on the profile and on its own page by the strictest level of the list and the profile; the notes stay private.
- A list that someone deletes goes with its titles (`ON DELETE CASCADE`); nothing else refers to a list yet. `activity` has a kind `list_created` that nothing writes, which belongs to SAG-44.

## Open questions

- Whether a list should ever be shared by a link that works without the profile being visible. Not decided; today the profile limits it.
- The statements run on the Neon driver in production, and were only tried with `pg` locally.

## References

- ADR-031 for `canView` and `strictest`; ADR-033 for the design rules (one statement for a data function, a thin route); ADR-043 for `ON CONFLICT DO NOTHING` with no target.
