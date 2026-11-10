# ADR-047: Big libraries are imported in the background, through a queue

- **Status:** Accepted
- **Date:** 2026-11-10
- **Implementation:** Done (SAG-241)
- **Tickets:** SAG-241
- **Related:** [ADR-035](035-saving-a-title-needs-a-session.md) (the daily budget of new titles), [ADR-007](007-background-work-cron-and-outbox.md) (background work), [ADR-044](044-contact-page.md) (a record that is deleted by age)

## Context

The import read one JSON file in one request. A request on the Workers Free plan has 50 subrequests and a title that only a provider knows costs 2 to 6, so one import could bring at most 6 new titles (`maxNewTitles`), 500 entries and 1 MB. A person with a library of about 1,500 titles could not import it, and raising the numbers would still run into the daily budget of new titles (300 a day for each person, ADR-035). Importing it by hand over days was the only way.

## Decision

An import has two phases.

1. **Upload** (the request of the person). The file is validated as before. The titles we already hold are written to the library at once, in one statement, and use no budget. Everything else is stored: one row in `import_jobs` (the choices of the person: replace, keep visibility, language, and the counters of what was written) and one row in `import_rows` for each title that waits (with its entry) and for each one left out (with the reason: `invalid`, `no_source`, `duplicate`, `unsupported_provider`). No provider is called. The limits are now 5 MB and 5,000 entries, and there is no cap of new titles.
2. **Resolve** (a Cron Trigger of its own, at minutes 5, 20, 35 and 50 of every hour). Each run takes at most 5 waiting titles from at most 2 people (3 each, the oldest first, and only from the oldest import of a person that still has something waiting). For each title it checks again whether we hold it now (another person may have saved it: no budget), then takes one unit of the daily budget of new titles, asks the provider, saves the title and writes the entry. A row that was written is deleted. A title the provider does not know is listed as `not_found`. When the provider does not answer, the unit is given back, the row waits an hour and after 3 tries is listed as `failed`. When the budget of the day is spent, everything that person has waiting is paused until the next UTC midnight.

The page `/settings/import` shows the latest import of the person: how many titles are in the library, how many wait (and that it can take days, at most 300 new titles a day, with no need to keep the page open), and, when something went wrong, a warning with the titles that did not import and why (the first 50, then a count). The rows live 30 days and are deleted with the account (`import_jobs` is in the erasure; the rows go with it). They are not in the data export: they are a copy of a file the person still has.

A run uses at most 46 of the 50 subrequests of its invocation: the claim (1), the budget (up to 5), the providers (5 titles of up to 6 each), for each of 2 people the two lookups, the write and a refund (4 each), the finish (1) and the pause of the day (1). It is calculated, not measured under a full load. The claim leases each row for 15 minutes (`retry_at`), so a run that starts while another is working does not take the same titles.

## Alternatives considered

- **Resolve inside the upload request.** Bound by 50 subrequests; it was the problem.
- **Cloudflare Queues.** A real queue, but it needs a paid plan and a new binding. The table is enough for 5 titles a run.
- **More titles per run, hourly.** The hourly trigger already uses 43 of 50. A trigger of its own is cleaner; the Free plan allows 5 and 4 are used.
- **A bigger daily budget for imports.** It would need a second counter and more load on TMDB. The owner chose to keep the same 300 a day: a library of 1,541 titles takes a few days, and the titles we already hold come in at once.
- **A notification in the inbox when the import ends.** Not built; the page shows the result. A follow-up if the owner wants it.

## Consequences

- Better: a big library can be imported; the daily budget is never passed (the same counter as `/media/open`); a provider outage uses no budget; the person sees what is left and which titles failed and why.
- Worse: a fourth Cron Trigger, and every run opens the database. Neon pauses the compute after 5 minutes without a query, so a query every 15 minutes keeps it awake about a third of the day, against a smaller share with the hourly trigger alone. The Neon Free plan gives 100 compute hours a month: **to be measured** after the first weeks. If it is too much, the trigger can run every 30 minutes (240 titles a day) or every hour with more titles per run.
- The upload writes the titles we hold and then stores the job in two statements, not one (the Worker has no transaction): if the second fails, the entries are written and no job is shown. Importing the file again is safe, since an entry the person has stays as it is.
- The upload parses up to 5 MB and 5,000 entries in a request whose CPU limit is 10 ms on the Free plan (see the architecture notes). The parse of 500 entries fit; 5,000 was **not measured** on the real runtime. If it is too slow, the limit goes down.
- Two runs that overlap (a run longer than 15 minutes) could take the same title twice; the lease makes it unlikely, and the worst case is one extra unit of the budget and a title saved twice, which is harmless.

## Update (SAG-242)

- **A notice when an import ends.** `import_jobs.finished_at` is set once: by the statement of the queue that resolves the last waiting title (`finishImportRows`), or at the upload when nothing waits. In the first case the same statement inserts one notification of type `import.finished` for the owner, with the number of titles in the library and the number of problems; its `dedupe_key` is `import:<job id>`, so a repeat adds nothing. A statement cannot see its own changes, so "nothing is left waiting" is the waiting rows minus the ones the statement resolves. Titles held until tomorrow or waiting for a retry count as waiting. The text is made when the page is read, in the language of the person, with a link to `/settings/import`. It uses no extra subrequest. Migration `0032` adds the column and the type to the check.
- **The titles that failed are listed a page at a time** (`?page=`, 50 each, up to the 5,000 entries a file may hold), not only the first 50.
- **A bar** on `/settings/import` shows the share of titles dealt with (in the library or listed as a problem) while some wait, so it reaches 100% when the import ends.

## Open questions

- The Neon hours with the new trigger, and the CPU of a big upload, after production use.

## References

- The limits of Workers (50 subrequests, 10 ms of CPU on Free, 5 Cron Triggers), read on 2026-10-20 and listed in `docs/architecture.md`.
