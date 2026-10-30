# ADR-024: Genres of a title, in a list of our own

- **Status:** Accepted
- **Date:** 2026-10-30
- **Implementation:** Done (SAG-71, SAG-86). The statistics by genre and the library filter that use the genres are SAG-86.
- **Tickets:** SAG-71, SAG-86, SAG-87, SAG-88
- **Related:** [ADR-016](016-provider-layer-and-tmdb.md), [ADR-021](021-books-open-library.md), [ADR-022](022-manga-mangadex.md), [ADR-023](023-statistics.md)

## Context

TMDB sends genres, MangaDex sends tags, and Open Library sends subjects, but `media_items` had no place for them, so all three were dropped (ADR-022 listed it as open). The owner asked (2026-10-30) for the genres of what a person has watched, with the time spent in each and the titles that belong to it, and for a list wide enough that niche genres (isekai, mecha, superheroes) are in it. Recommendations by similar genres (SAG-87) need them too.

The three sources do not agree:

- **TMDB** sends numbers that are the same in every language, in a search (`genre_ids`) and in a title (`genres`). A few series genres are two in one ("Action & Adventure", "Sci-Fi & Fantasy"), and "Animation" and "TV Movie" are formats.
- **MangaDex** sends tags in the same answer we already read, in four groups: `genre`, `theme`, `format` and `content`. The list of tags was read on 2026-10-30 from `GET /manga/tag` (25 genres, 38 themes, 12 formats, 2 contents).
- **Open Library** sends subjects as free text, mostly English and noisy ("Fiction", "Juvenile literature"). Only the work (`/works/<id>.json`) has them, not the search.

## Decision

**A list of our own, in code** (`server/providers/genres.ts`): 49 keys such as `action`, `sci_fi`, `isekai`, `mecha`, `superhero`, `boys_love`, `reality`. The names a person reads are in the locale files under `genres`, in both languages, and a test checks that the two files name exactly the genres of the list. **Every provider maps what it sends to these keys and drops the rest**, so a provider's own tags are never stored (the ticket asked for it). Adding a genre is a line in the list and its two names.

**One column** (migration `0012`, additive): `media_items.genres`, a `jsonb` list of keys, like `creators`. `NULL` means the source was never asked; `[]` means it was asked and none of ours fits, so the refresh does not ask again. A refresh that sends none never erases the genres we hold, and an empty list is kept only when we hold nothing. A check says the value is a list. The keys are checked in the code, not by the table, so a new genre needs no migration; the page leaves out a key that is no longer on the list.

**The mapping of each source**

- **TMDB** by number (`genreOf` in `server/providers/tmdb/map.ts`). The two joined series genres give two of ours, and the formats give none. A response with neither `genre_ids` nor `genres` does not say the genres.
- **MangaDex** by the English name of the tag, only in the groups `genre` and `theme`; `format` and `content` are never read (`genreOfTag` in `server/providers/mangadex/map.ts`). A few tags join into one genre (Ghosts and Demons into `supernatural`, Police and Mafia into `crime`, Harem and Reverse Harem into `harem`).
- **Open Library** by patterns over the English subject, only for what clearly names a genre (`genreOfSubject` in `server/providers/open-library/map.ts`), so many books will have none. A search does not say the genres; a work with no subject says none.

**The titles saved before** are filled by the job that already refreshes titles (`findMediaToRefresh`, every 6 hours, 5 titles each run): a title with `NULL` genres is asked once, whatever its source. **The titles that are in somebody's library go first**, after the stale ones, so what a person sees is filled before the rest of the catalog. No command is needed. The 6-month rule of TMDB (ADR-016) covers the genres too: they are part of the data the job refreshes.

**The title page** shows the genres as a list of labels. For a signed-in person each label is a plain link to the library filtered by that genre (`/library?genre=X`, SAG-86); a visitor has no library, so for them it stays a label. The statistics by genre are in ADR-023.

## Alternatives considered

- **Keep each provider's own genres.** The three vocabularies do not match ("Action" of TMDB, "Action" of MangaDex, "Adventure stories" of Open Library), so no count or filter across formats would work, and the ticket asked to keep the provider's tags out of the catalog.
- **A table of genres and a table that joins them to titles.** It is the answer when genres carry data of their own (a description, a parent genre) or a title has thousands of them. A list of keys is enough here, it is read with the title in the same row, and `@>` answers "titles of this genre". The library filter of SAG-86 runs it inside the entries of one person, so no index was added; if a query that spans the whole catalog is ever needed (for example for recommendations, SAG-87), a GIN index is the next step. It can become a table later without changing the list.
- **A Postgres enum or a check of the keys.** Each new genre would need a migration. The list is expected to grow, and the code already refuses what is not on it.
- **A short list of about 20 genres.** It leaves out what people who watch anime and read manga look for (isekai, mecha, magical girls). The owner asked for the niche ones too.
- **Reading the subjects of Open Library with a model or a translation.** It adds a cost and a dependency for a source that is noisy by nature. A conservative pattern list is plain, and a book with no genre is said so in the statistics.
- **Leaving books out.** The owner prefers that a book with a clear subject has a genre; the ones with none are counted apart.

## Consequences

**Good**

- One list for every format, so a count by genre adds anime, series, movies, manga and books.
- Both languages come from the locale files, so no name is stored and a translation is a text change.
- It adds no call: TMDB and MangaDex already send the data, and Open Library's work is already read when a book is opened.

**Worse, or new work**

- **Most niche genres will only come from manga for now.** TMDB sends no genre like isekai or mecha, so an anime or a series will have the genres TMDB knows (action, drama, fantasy...). A person who wants those on anime needs TMDB's keywords (see Open questions).
- **The Open Library mapping is lossy**: English subjects only, and many books will have none.
- **The titles saved before are filled slowly**: 5 per run, 20 a day, shared with the lengths of SAG-61. The titles in a library go first.
- A source that never says the genres of a title leaves it with `NULL`, and the job would ask about it again once a day. TMDB and MangaDex always send them, and Open Library's work answers with an empty list, so none is expected to loop.

## Open questions

- **Not verified:** the numbers of the TMDB genres. They are TMDB's published list for movies and series, written from it, and were not read from a live answer because that needs the TMDB token. If a number is wrong, its genre is dropped or wrong; after the first runs of the job, look at the genres of a few well-known titles.
- **Not built:** the niche genres of anime and series. TMDB has keywords (for example the ones that say a series is an isekai) that could feed them. It is a ticket of its own (SAG-88): it asks one more call per title and its terms and numbers must be read first.
- **Not built:** recommendations by similar genres (SAG-87). The statistics by genre and the filter `genre=X` of the library are done (SAG-86).
- Whether to show the genres in the search results; today only the title page does.

## References

- MangaDex: the list of tags, read 2026-10-30 from `GET https://api.mangadex.org/manga/tag` (<https://api.mangadex.org/docs/>).
- TMDB: the lists of genres of movies and series (<https://developer.themoviedb.org/reference/genre-movie-list> and <https://developer.themoviedb.org/reference/genre-tv-list>), not read in this session.
