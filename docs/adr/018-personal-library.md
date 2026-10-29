# ADR-018: The personal library

- **Status:** Accepted. The "Watching again" rule is superseded by [ADR-019](019-library-viewings.md).
- **Date:** 2026-10-25
- **Implementation:** Partial (SAG-18): the core for movies, series and anime. Import from CSV, quick actions with an optimistic interface, progress for books and manga, and the `activity` and `outbox` events are separate tickets.
- **Tickets:** SAG-18, SAG-17, SAG-12, SAG-21, SAG-27
- **Related:** [ADR-014](014-account-deletion-erases-everything.md), [ADR-017](017-media-pages-and-image-proxy.md), [ADR-011](011-edge-security-and-domain.md)

## Context

A person needs to keep track of what they watch: a status, how far they got, a score, dates and notes, for each title. The table `library_entries` already existed (SAG-9), with its constraints, and account deletion and the data export already read it (SAG-12). SAG-18 builds what uses it. The ticket is large, so this ADR records what the first part includes and the rules it follows.

## Decision

**No migration.** The table has what is needed: status (`planned`, `in_progress`, `completed`, `paused`, `dropped`), progress, score (1 to 10), start and finish dates, a counter of times watched again, notes (2000 characters) and a visibility that is private by default. Nothing had to be applied to production by hand.

**Pages and routes.**

- `/library`: the entries of the signed-in person, filtered by type, status, year and minimum score, sorted (recent, title, score, year) and paged (24 a page). The filters are a plain `GET` form.
- `/library/:mediaId`: one entry, to set the status, the progress, the score, the dates, the notes and the visibility; to start a completed title again; and to remove it. A person with no entry for that title, and a title that does not exist, both get a `404`, so the page does not say which.
- `POST /library/add`: the button of the title page. It adds the title as "planned" and goes to the entry page. It is a plain form that reloads the page, so it works without JavaScript and lands in a new document.
- The title page (`/media/…`) shows a signed-in person their status and a link to the entry, or the add button; a visitor gets a link to sign in. Because that block depends on the person, the page is `Cache-Control: private, no-store`.

**Every write is the person's own.**

- The person is the one in the verified session. No form field names a user, and a field the form does not have makes the request invalid (`z.strictObject`).
- Every query has `user_id = <the person>` in its `WHERE`, so knowing a title id is not enough to read, change or remove somebody else's entry. This is tested against a real database with two people.
- Each write checks the `Origin`, refuses a body over 16 KB, is limited by `WRITE_LIMITER` per person, and validates with Zod. An error names the field, never echoes the value.
- Only titles from a provider can be added; a `custom` title (made by a person for themselves) cannot be added by someone else.

**The rules are one pure function** (`server/library/rules.ts`), tested on its own:

- Progress is the number of episodes watched, over the whole title (specials are not counted). The page shows where that leaves the person ("season 2, episode 3").
- Reaching the last episode in a save completes the title and sets the finish date. It does not override a status picked on purpose (paused, dropped), and it does not fire again on a title that was already at the end. A title marked completed has all its episodes seen. A planned title with episodes seen becomes "in progress".
- The start date is filled in with today when a title is started and the person left it empty, and the finish date when it is completed. A date the person typed is never replaced. A finish date before the start date is refused by the rules and, as a second wall, by a constraint of the table.
- A movie has no episodes, so it has a status, a score, dates and notes, and no progress.
- **Watching again**: "Watch it again" on a completed title sets it back to "in progress" with progress 0 and a new start date, and adds one to the counter **at that moment**. It counts the times a person started again, not the times they finished again. The score and the notes stay.
- Scores are whole numbers from 1 to 10. Half points would need a migration and were left out.

**The data export** has the library in the JSON file and, in the CSV file, as a second table below the profile (title, status, progress, score, dates, times watched again, notes, visibility, date added). Lists and custom entries are still only in the JSON file. A cell that starts like a formula is quoted so a spreadsheet does not run it.

**Security policy.** `/library` and everything under it are session pages (`isSessionPage`): they get the narrow policy of ADR-011 that lets Clerk's script renew the session, because the entry page has a form that can stay open longer than the 60 seconds a session token lasts. No new origin is added. Links from other pages to the library are plain links, and the add form reloads the document, because a new document is what gets the policy.

## Alternatives considered

- **Do the whole ticket in one PR.** Import from CSV, quick actions with an optimistic interface, a grid view and book and manga progress are each a feature of their own, and the last one depends on books existing (SAG-14). One PR for all of it would be hard to review. They became tickets.
- **Add a "rewatching" status.** It means a migration of the enum, and the status can be told from "in progress" with a counter that is already in the table.
- **Count a watch again when it is finished.** It needs to remember that the current run is a repeat, which the table has no column for. Counting when it starts needs nothing new.
- **Emit `activity` and `outbox` events now.** The ticket asks for them, but nothing reads them yet (the feed is SAG-21, the delivery SAG-27), and what to publish depends on the privacy decisions of the social graph. Writing events nobody reads would also mean deciding who may see what before the rules exist.
- **A progress per season.** One number over the whole title is simpler to type and to keep consistent; the page translates it into a season and an episode.

## Consequences

**Good**

- A person can follow a series episode by episode, and nobody else can change their entries; the second part of the acceptance criterion is tested against a real database.
- Deleting an account and the data export already cover the library (ADR-014); the integration test that lists the tables a user deletes still passes, because no table was added.

**Costs and risks**

- The visibility is stored and can be changed, but nothing shows an entry to anyone else yet. The page says so. It takes effect with the public profiles (SAG-21).
- The write from the title page is a native form post. If the session ran out between loading the page and pressing the button, the person is sent to sign in and back to the title, and has to press again.
- The editor and the pages were checked with unit tests, rendered pages and integration tests, and the checks of what a visitor and another site can do in the browser. A full run as a signed-in person was **not** done: the end-to-end tests cannot create a Clerk session. It must be tried on a preview.

## Open questions

- Whether "friends only" and "public" entries should show the notes. The notes are described as private today, and no one else sees anything, so the question is for SAG-21.
- ~~The progress of a book or manga (pages, chapters, volumes) depends on SAG-14.~~ Answered by the amendment of SAG-43 below.
- Whether the library page needs a search box of its own once libraries are large.

## Amendment (2026-10-27, SAG-57): tabs by type, sections by status

The library page was one list with a form of filters. Most of the time the person wants to see what they are watching now, so the page changed. The data, the rules of an entry and the privacy of the library are the same.

- **Tabs by type** (`?type=`): all (the default), anime, movies, series, books and manga. A tab is never hidden; a tab with nothing says so. Each tab shows how many entries match the search and the filters.
- **Sections by status**, in a fixed order: in progress, planned, paused, dropped, completed. The sort applies inside each section, never to the order of the sections. Each section is a native `<details>` (it works without JavaScript); completed starts closed and opens by itself when the person is searching or on a later page of it. A section with nothing starts closed and says so. The old `?status=` filter is gone: the sections replace it, and an address that still has it opens the library without it.
- **Search and filters, one set per tab**: text in the title (ignoring case and accents), year, minimum score and sort. The text matches the title, the original title and the name in every language we hold, with `immutable_unaccent` (ADR-002, migration 0002), so it needs no migration and `%` and `_` are plain characters. The search and the filters stay when the tab changes.
- **Pages by section** (`?completed_page=2`), 12 entries each, as plain links: a page past the last one shows the last one. Changing the tab or the view sends every section back to its first page.
- **Two queries** whatever the number of sections (ADR-001, 50 subrequests per request): one counts by type and status (the tabs, the totals and the last page of each section), and one takes the page of every section with `row_number() OVER (PARTITION BY status)`. The id at the end of the order keeps entries that tie from one page to the next. With 3000 synthetic entries on a local database each answered in under 30 ms; a real database over the network will be slower, and this was not measured.
- **Three views**: covers (as before), titles only and a grid of covers. The address (`?view=`) wins and is remembered in a preference cookie, `libraryView`, like the language one: it works without JavaScript and holds nothing else. The privacy policy names it. Whether a section is open or closed is **not** remembered.
- **Visibility filter** (SAG-59): `?visibility=public|friends|private`, a select next to the year and the score, kept when the tab changes and applied to the totals, the tab counts and the sections. A small label ("Public", "Friends") appears on the card only when the entry is not private. No migration: the column and the filter by person already existed.
- **Not done**: a table view, and remembering open sections.

## Amendment (2026-10-29, SAG-43): progress in pages, chapters and volumes

Open Library and MangaDex give no parts, so a book or a manga has no total in the catalog (`getParts()` returns nothing for both). Progress is still one integer, `library_entries.progress`, but what it counts and where the end comes from now depend on the kind of title.

- **Two optional columns** on `library_entries` (migration `0010`, additive): `progress_unit` (`pages`, `chapters` or `volumes`) and `progress_total` (how many the person's edition has). Checks: the unit is one of the three; a total needs a unit, is above zero, and `progress` never passes it. A series, an anime or a movie leaves both empty and keeps counting episodes against the catalog.
- **Units by kind of title** (`progressUnitsFor`): a book counts pages; a manga counts chapters (the default) or volumes, the person picks. A unit the kind of title cannot count is dropped on save and on import.
- **The total is typed by the person and optional.** Every edition has a different number of pages, so the catalog's number would often be wrong. Suggesting a total from the catalog (Open Library's page count, MangaDex's last chapter and volume) is left to a later ticket.
- **Same rules as episodes** (`applySave`): the end is the total; progress above it is refused (`progress_too_high`); reaching it completes the title unless the status is paused or dropped; a title marked completed has all its units done. Without a total a book or a manga never completes by itself. Typing the total after the last unit was already reached also completes it.
- **Library list**: "120 of 320 pages" with a bar, or "120 pages" without a bar when there is no total. A title with no progress and no total shows nothing.
- **Export and import**: the JSON entries and the CSV carry `progressUnit` and `progressTotal`. `schemaVersion` stays 1: the change only adds fields, and a file from before it still imports (a book then reads as pages with no total).
- **Wording** (SAG-76): the words about watching a title again (the card, the history and the "watch it again" button) say "read" for a book or a manga. They use an i18next context, `read`, chosen by `readingContext` in `app/lib/media.ts`; the other kinds keep "watched". The keys and the data are the same.

## Amendment (2026-10-29, SAG-42): a quick +1 in the library

A person can add one episode, page, chapter or volume from the library page, without opening the entry.

- **Where:** a button "+1" on each row of the covers view and of the grid. The list of titles has no progress, so no button. It is there for a title that counts something (the episodes of the catalog, or the pages, chapters or volumes of a book or a manga), that is not completed and has not reached its end; a book with no total can always go one more (`canStep`).
- **Rules:** none new. `applyStep` is a save of the whole entry with the progress one higher (`applySave`): the end completes the title unless it is paused or dropped, going past the end is refused, and a planned title becomes in progress with a start date.
- **Route:** a resource route, `POST /library/<id>/step` (`library.$mediaId.step.ts`), with the protections of the other write endpoints: `Origin`, a body of at most 1 KB, the person of the session, the write limiter (30 a minute, shared with the editor) and a query that has the id of the session. Every refusal is an answer with data, never an error thrown to the page, so a rate limit or a failure cannot replace the library with an error page; the pattern is the one of the username form.
- **Optimistic:** the button is a `fetcher.Form`. While the step is on its way the row shows one more in the words and in the bar (`useShownRow`, from the fetchers in flight) and the button is off, so no step is lost by pressing twice. When the server answers with an error the fetcher is idle again, the real number comes back and the row says the progress could not be saved. When it answers well, the loader runs again and the row may change section.
- **Without JavaScript:** the same form posts to the same route. A browser that submits a form asks for a document (`Sec-Fetch-Dest: document`), and then the answer is a redirect to the library, or to the entry when the step was refused, instead of the JSON.
- **The title page** (second part of SAG-42): a signed-in person adds the title, changes its status and counts one more without leaving the page (`app/components/TitleLibrary.tsx`). The status is five buttons that are plain form buttons (`POST /library/<id>/status`, `applyStatus`: the same rules as the editor, so completing gives every episode and "planned" with progress stays in progress, and that button is off when there is progress); the +1 reuses `/step`; the add posts to `/library/add`, which answers with data to a `fetch` (`Sec-Fetch-Dest: empty`) and keeps redirecting to the entry for a document.
- **One fetcher for the panel**, and every button off while it saves: there is never more than one change on its way, and the message of a refusal is about the last one. What is shown while it saves follows the rules of the server (`shownEntry`).
- **Without JavaScript** the forms work and the person goes back to the page they were on: `returnPath` accepts only the library (rebuilt with `libraryBackPath`) and a title page of this site, and anything else goes to the fallback. The `/step` route now does the same.
- **The links back** of the title page (SAG-79 and SAG-81) are kept from the first load in the state of the page: after a button the loader runs again with the title page as the `Referer` and would drop them. A new title (another `key`) starts again. This has no automated test: the tests render on the server.
- **The search results** (SAG-80): a signed-in person adds a result from the search without opening it. A title we hold that they do not goes through `/library/add`; one that only a provider knows goes through `/library/add-external`, which saves it and adds it in one step (ADR-004). The result says "In your library: <status>" at once and, once saved, links to its page. Without JavaScript the same form takes the person to their entry, and a refusal sends them back to their search. Only "Add" is offered: the status is changed on the title page.
- **Not done:** the status and the +1 from a search result, and the message of a failed change has no automated test: the tests render on the server, where a finished fetcher keeps no answer.

## Amendment (2026-10-29, SAG-81): going back keeps where the person was

The library links to the entry page and never to the title page, so "back to my library" matters on the entry page. Its link used to go to `/library` with nothing, and the person lost the tab, the search, the filters, the sort, the view and the page of each section.

- **The entry page** reads the `Referer` of its first load. `libraryBackPath` (`server/library/path.ts`) accepts only the library of this site (same origin, path exactly `/library`), reads the address with `libraryQuerySchema` (a value the page ignores is ignored here too) and builds it again with `libraryPath`, the function the library page uses for its own links. Nothing else of the `Referer` is kept. From anywhere else the link goes to `/library`, as before.
- **It is read once.** Saving the entry runs the loader again with the entry page itself as the `Referer`, so a data request does not recompute it and the page keeps the first value.
- **The title page** opened from an entry (its "View the title page" link) shows "Back to my entry", from `entryBackPath`: the path must be `/library/<id>` with a UUID, and the address is built again from the id. It is a whole-page link because the entry page has its own security policy.
- **Not kept:** library, entry, title and entry again: the `Referer` of the second visit to the entry is the title page, so the link goes to `/library`.

## References

- Ticket SAG-18 (Linear)
