# ADR-020: Restoring the library from the data export

- **Status:** Accepted
- **Date:** 2026-10-27
- **Implementation:** Partial (SAG-41): the import of our own export. The import of a CSV from other trackers is SAG-52.
- **Tickets:** SAG-41, SAG-52, SAG-48, SAG-12
- **Related:** [ADR-017](017-media-pages-and-image-proxy.md), [ADR-019](019-library-viewings.md), [ADR-014](014-account-deletion-erases-everything.md), [ADR-001](001-runtime-react-router-on-workers.md), [ADR-002](002-data-postgres-neon-drizzle.md)

## Context

A person can download their data (SAG-12) and delete their account (ADR-014). The owner asked (2026-10-25) that the file can also be imported, so a person can export, delete the account, create a new one and get the library back. The ticket also asked for a CSV from other trackers. The two are different in cost: the Workers Free plan allows **50 subrequests per invocation** (ADR-001, read 2026-10-20) and each database query counts (ADR-002), so matching hundreds of rows through the search does not fit in one request. The CSV was split into SAG-52.

## Decision

**The export carries what an import needs.** The JSON file has `schemaVersion: 1`, and each library entry has `source: { provider, id }` (for example `tmdb` and `tv/1429`), the first external id of the title. These are public catalog ids, not personal data, and they let a title be matched exactly instead of by its name. The CSV has the same two values as columns `provider` and `external_id`. A file downloaded before this change has neither, so it cannot be imported: the person downloads a new one.

**The import page** is `/settings/import`, linked from "My data". It is a session page like the rest of `/settings`.

1. The person chooses the file (a multipart form, read with `readForm`, which counts the bytes that arrive). The size limit is 1 MB and the entry limit 500.
2. **Preview.** The server reads the file and answers with counts and a list of what would be left out. Nothing is written.
3. **Confirm.** The form sends the text of the file again and the server validates it again. Nothing is kept between the two steps and nothing from the preview is trusted, so there is no state to expire or to tamper with.

**What is read from the file.** Only `libraryEntries`, and in each entry only `source`, `title` (to show it in a list), `status`, `progress`, `score`, `startedAt`, `finishedAt`, `notes` and `viewings`. The profile, the lists, the custom entries, any id of a person or of a title of ours, a visibility and a `rewatchCount` are never looked at. The values pass the same limits as the editor (status, score 1 to 10, real dates, finish not before start, notes of 2000 and 500 characters counted as characters, 50 viewings). An entry that does not pass is left out and listed with its title and a reason; the rest still import. An entry with no source, with a source that has no provider here, or a repeat of the same title is listed too.

**The person is the one in the session.** The rate limit is per person (`import:<id>`), the `Origin` is checked, and every write has the id of the session. Nothing in the file chooses the person.

**Never public.** A new entry is written as `private`. An entry the person already has keeps the visibility it has.

**Titles we do not hold.** A title is found by `(provider, external id)` in `media_external_ids`. If it is not there, it is **never created from the data of the file**: that would let anyone put invented titles in the catalog everybody shares. It is asked of the provider with `importMedia`, like any title that somebody opens (ADR-017), and only what the provider answers is saved. At most **6** such titles are asked in one import (a movie takes about 2 subrequests, a series with seasons up to about 6, and the lookup, the write and the session need a few more). The rest are listed as pending and a second import of the same file brings the next ones. Titles that are shared stay in the database when an account is erased (ADR-014), so restoring one's own library almost never asks the provider.

**What already exists.** An entry the person already has is kept as it is, unless they check "replace". Then the fields and the earlier viewings of the file replace the ones of that entry (ADR-019).

**Rules of the entry.** The same as the editor except that no date is invented: a completed title has all its episodes seen, the progress never passes the last episode, a planned title with episodes seen is in progress, and only a completed title has a finish date.

**One write.** The entries and their viewings are written in one SQL statement (`writeEntries`), so a file is imported whole or not at all, and the number of subrequests does not grow with the number of entries. The ids of our titles come from `lookupTitles`, never from the file.

## Alternatives considered

- **Import a file that has no ids by matching the name.** It guesses, and a wrong guess writes someone's status on a different title. The ticket asked for exact ids.
- **Create the missing titles from the file.** One request per title is saved, but anyone can invent titles in the shared catalog. Rejected.
- **Keep the preview on the server** (a table or the cache) and confirm it by an id. It needs a place to store a file for an hour and a rule to delete it. Sending the file again costs at most 1 MB and nothing to clean up.
- **Do the CSV in the same ticket.** It needs fuzzy matching per row and many provider calls, which does not fit in one request on the Free plan. It is SAG-52, probably with a background job.
- **Read the file in the browser and send JSON.** It would move the size check to the client, which the server cannot trust anyway.

## Consequences

**Good**

- Export, delete the account, create another and import brings the library and its viewings back; this is a test against a real database.
- A hostile file (huge, deeply nested, repeated, with the id of another person or a public visibility) is refused or ignored, with tests for each.

**Costs and risks**

- Files downloaded before this change cannot be imported.
- The cap of 6 new titles means a person with many titles that nobody else holds imports in several rounds. The page lists what is pending.
- Lists and custom entries are not imported yet; the file has them and they are left alone.
- A full run as a signed-in person (choosing a real file in the browser) was **not** done: the end-to-end tests cannot create a Clerk session. It must be tried in the real site.
- The preview sends the whole file back in a hidden field, so a 1 MB file travels three times. It is the price of keeping no state.

## Open questions

- Lists and custom entries.
- The import of a CSV (SAG-52) and how its rows are processed.
- Whether the cap should be higher on the paid plan, which has a much larger subrequest limit.

## Amendment (2026-10-27, SAG-55): keep the visibility of the file, if the person asks

The rule "Never public" above becomes **private unless the person asks otherwise**. After restoring a whole library the person had to mark the public entries again one by one.

- The confirm step has a checkbox, "Keep the visibility stored in the file", **unchecked by default**. Like "replace", it travels in the confirm form, because that step keeps no state.
- Unchecked: as before, every new entry is `private`. Checked: a **new** entry gets `public`, `friends` or `private` as the file says. An entry the person already has keeps its own visibility, also with "replace" (the `DO UPDATE` never writes it).
- The file is still data from outside, so `visibility` is read with the strict entry schema: any value that is not one of the three levels, or a missing one (a file from an older export), reads as `private` and the entry is not rejected. Nothing else changes about who the entries belong to.
- The preview says it before the person confirms: how many of the titles it would add are public or for friends in the file, and that they stay private unless the box is checked. It counts the titles we hold and the ones asked of the provider; a title the provider then does not find is not added, so the count can be a little high.
- `friends` is kept as the file says even though nothing shows it differently from `private` yet.

The open question of the caveat in "Consequences" is unchanged: a full run as a signed-in person was not done in the end-to-end tests, only the unit, render and integration tests.

## References

- Tickets SAG-41 and SAG-52 (Linear)
- Cloudflare Workers limits, <https://developers.cloudflare.com/workers/platform/limits/> (the 50 subrequests of the Free plan, as recorded in ADR-001, read 2026-10-20)
