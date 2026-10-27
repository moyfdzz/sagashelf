# ADR-018: The personal library

- **Status:** Accepted. The "Watching again" rule is superseded by [ADR-019](019-library-viewings.md).
- **Date:** 2026-10-25
- **Implementation:** Partial (SAG-18): the core for movies, series and anime. Import from CSV, quick actions with an optimistic interface, a grid view, progress for books and manga, and the `activity` and `outbox` events are separate tickets.
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
- The progress of a book or manga (pages, chapters, volumes) depends on SAG-14.
- Whether the library page needs a search box of its own once libraries are large.

## References

- Ticket SAG-18 (Linear)
