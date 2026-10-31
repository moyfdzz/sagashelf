# ADR-026: Sagas, curated in code and built on Wikidata

- **Status:** Accepted
- **Date:** 2026-10-31
- **Implementation:** Partial (SAG-25). The page, the badge and the 21 curated sagas are done. The curation screen and the suggestions of missing works by people are not (they need an administrator, see below).
- **Tickets:** SAG-25, SAG-16, SAG-87
- **Related:** [ADR-025](025-wikidata.md), [ADR-007](007-background-work-cron-and-outbox.md), [ADR-018](018-personal-library.md)

## Context

A saga is one story in every format: the manga, the anime, the films and the games of _Attack on Titan_. The tables `sagas` and `saga_members` existed since SAG-9 but were empty, and the "other formats" of a title (ADR-025) was only a list at the end of one page. SAG-25 asks for a page per saga with the works in order and the person's progress in each, a badge on the pages of titles, automatic suggestions from Wikidata that are never published without review, manual curation by an administrator, suggestions of missing works by people (through moderation), and at least 20 well-known sagas at launch.

Two facts decided the design (read from the SPARQL endpoint on 2026-10-31, one read-only query each):

- **The franchises of Wikidata are very uneven in size.** Members of the media franchise (`P8345`): Star Wars 3183, One Piece 1320, Dune 235, Dragon Ball 210, Evangelion 184, Bleach 143, Naruto 94, Attack on Titan 23, Death Note 13. A page that lists a whole franchise is useless for the large ones, and the members query of ADR-025 cuts at 400 rows.
- **A franchise lists more than the story**: toys, spoofs, fan films, video games and children's shorts. The ones a catalog knows (a TMDB, MyAnimeList, AniList or Open Library id) are mostly the real works.
- **There is no administrator** (the open decision of ADR-003), so there is nobody to review a suggestion.

## Decision

**The sagas are curated in code**, in `server/sagas/curated.ts`: for each saga a slug, its name in both languages and its works as Wikidata items in the order of the story. 21 sagas were written on 2026-10-31: Attack on Titan, Death Note, Demon Slayer, Jujutsu Kaisen, My Hero Academia, Chainsaw Man, Spy × Family, Vinland Saga, Berserk, Cowboy Bebop, Neon Genesis Evangelion, Fullmetal Alchemist, Naruto, Bleach, One Piece, Dragon Ball, Breaking Bad, The Matrix, Dune, Harry Potter and Star Wars. Each list was taken from the members of the franchise that are a film, a series, an anime, a manga or a book **and** have an id in a catalog we use, minus what is not part of the story (a test checks the shape: at least 20 sagas, unique slugs, valid item ids, no work twice). A change to a saga is a pull request, so it is reviewed like code and needs no administrator. The order of the story is the order of the list; the release order comes from the year. For Star Wars the list follows the chronology of the story (written from general knowledge, not from Wikidata: Wikidata has no in-universe date), which is the one place the two orders differ. A page offers both orders only when they differ.

**Tables** (migration `0014`, additive):

- `saga_wikidata_members (saga_id, qid, position)`: the works of a saga by their Wikidata item. A work may be a title the catalog holds or only a name Wikidata knows, so it is matched to the catalog when a page is read (`mediaMatchesItem`, the same rule as the "other formats" of ADR-025: the item it was looked up as, or the same TMDB, Open Library, MyAnimeList or AniList id). The old `saga_members` (a foreign key to a catalog title) stays for titles added by hand later.
- `sagas.titles` (the name per language) and `sagas.source_hash` (a fingerprint of the curated entry, so a saga is saved again only when its entry changes).
- `wikidata_items.year` and `details_at`: the members query now also asks for the publication or start date (`P577`, `P580`), and `details_at` says the item was described by it.

**A job in the cron** (`server/jobs/sync-sagas.ts`, after the Wikidata job): one query says which curated sagas changed and which work items have not been described yet; the changed sagas are saved in one statement, and the missing items are asked from Wikidata in one members query (up to 300 per run) and saved. With nothing to do it costs **one subrequest**; the first run costs four (the query, the save of the sagas, one call to Wikidata and its save). With the refresh job (about 41) and the Wikidata job (4) that is at most 49 of the 50 a scheduled invocation shares. **This is tight and was not measured against the real runtime.** If Wikidata fails, the sagas are already saved and the items are asked again on the next run; a saga page lists only the works that are described.

**The page** `/sagas/<slug>` is public and server rendered, with a title, a description, a canonical address and Open Graph data. It lists the works grouped by format (the group order is fixed, the order inside a group is the one chosen), links the ones the catalog holds and names the others as plain text. A signed-in person also sees, for each work they hold, its status and how far they are, an overall percent and where to start. The page is `private, no-store` like the title page, because it shows what the person has done. It is not a session page (no Clerk script): it reads the session like the title page does.

**Progress.** A work is 1 when completed, 0 when planned or when it has no total, and progress over total otherwise (the total is the episodes of the catalog without specials, or the edition total of a book or manga). The overall percent is the mean over the works **the catalog holds**; a work only Wikidata knows cannot be tracked and does not pull it down; a held work the person does not have counts as 0. "Where to start" is the first work of the chosen order when the person has nothing in the saga, and the first held work not yet finished otherwise.

**The badge** "Part of the X saga" on a title page links to the saga. The query that finds a title's sagas hides its failure: the page shows without the badge.

## What is not in this ticket, and why

- **Automatic suggestions as drafts, and the curation screen.** The ticket asks for suggestions from Wikidata that are never published without review. With no administrator there is nobody to review them, so drafts would be invisible rows. The "never auto-publish" rule holds in the simplest way: nothing is published except what is in the curated file. Drafts need the screen, and both wait for the decision about the administrator.
- **Suggestions of a missing work by a person** (goes to moderation). It needs a place to review it, the same missing screen, and a new target type in `reports`.
- **A list of all sagas** (`/sagas`) and a sitemap. A saga is reached from the badge today.

## Alternatives considered

- **Build the sagas automatically from the franchises.** The sizes above show it does not work for the large ones, and the results would need review that nobody can do yet.
- **Curate in a web screen.** The right answer in the end, but it needs the administrator decision first.
- **Store the works in `saga_members`.** It needs a catalog title, and a saga must name works the catalog does not hold yet.
- **A column for the order of the story and another for the release order.** The release order is the year, which Wikidata already gives, so only the story order needs to be curated.

## Consequences

**Good**

- A person sees the whole story in order and where they are in it; the badge connects the pages of titles.
- Reviewing a saga is reviewing a diff.

**To watch**

- **Completeness depends on Wikidata and on the catalog's ids.** _Berserk_ has two works (the manga and the 1997 anime); a work Wikidata lacks, or has no catalog id for, is not in the list.
- **The works only appear as links when the catalog holds them**, which today means the titles that have been opened. The pages become richer as the catalog grows.
- **A work whose date Wikidata lacks goes last** in the release order.
- **Not measured:** the subrequests and the CPU time of the job in the real runtime, and the real size of the first run (about 160 items). The Cloudflare logs show `sagas.sync` and `job.failed` after the first runs.
- **Not tried in production:** the pages with real data and a real library.

## Facts that were checked

Sizes of the franchises and the lists of members, read on 2026-10-31 from <https://query.wikidata.org/sparql> (a handful of read-only queries); the properties and classes as in ADR-025. **Not verified:** the chronology of Star Wars against a source (it is written from general knowledge and is the first thing a reviewer should read), and how the first run behaves against the real endpoint.
