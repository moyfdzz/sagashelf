# ADR-028: Recommendations from genres and sagas

- **Status:** Accepted
- **Date:** 2026-10-31
- **Implementation:** Done (SAG-87). The signals that need other people's data or a provider's recommendations are left for later.
- **Tickets:** SAG-87, SAG-71, SAG-25, SAG-21, SAG-23
- **Related:** [ADR-024](024-genres.md), [ADR-026](026-sagas.md), [ADR-018](018-personal-library.md), [ADR-016](016-provider-layer-and-tmdb.md)

## Context

The owner asked (2026-10-30) for a place to find what to watch or read next from what a person already likes. The ticket left open whether it is a section of the search or a page of its own, and which signals to use: genres, sagas, what other people search or add, and the recommendation endpoints of the providers. It asked to start with the simplest signal, which needs no data of another person, and said that a recommendation must never reveal what somebody has in a private library.

What is in the database that serves (all of it already there since SAG-71 and SAG-25): the genres of each title, in a list of our own (`media_items.genres`); the sagas, with their works in order and the works matched to the catalog; and the library of each person, with status and score. What is **not**: much catalog. It holds only the titles that somebody has opened or saved, so at first the offer is small, and the page says so.

## Decision

**A page of its own**, `/recommendations`, linked from the account menu between "Statistics" and "Settings". It is private (`private, no-store`), not indexed, and for a person with a session like the statistics page; the search keeps its own job. It makes **two reads**, in parallel, of the library of the person of the verified session, and no call to any provider.

**Signal 1: the genres a person likes** (`getGenreRecommendations`). A genre is liked by what the person did with the titles that have it, a planned title saying nothing: each **score** adds its distance from 5 over 5 (a 10 is +1, an 8 is +0.6, a 3 is -0.4); a title with **no score** adds 0.5 when completed, 0.2 when in progress or paused, and takes 0.3 away when dropped. A genre whose sum is not above zero is not liked, so a dislike takes from a like. The page offers the titles of the catalog that the person **does not have in their library, in any status**, ordered by their **affinity**: the sum of the liked genres the title has, divided by the square root of the number of its genres, so a title does not win just for having many of them. Ties go to the more popular title (`media_items.popularity`). Up to 20 are listed, each with its reason, "Because you like: Mystery, Psychological and Thriller" (the first three genres, the most liked first). A title with no genres, or whose genres were never asked (`NULL`), cannot be offered, and neither can what a person made for themselves (`custom`).

**Signal 2: what is missing of the sagas a person started** (`getSagaSuggestions`). For each **published** saga (ADR-026; a draft is never read) in which the person has at least one entry, in any status, the works they do not have in their library, in the order of the story. A work is matched to the catalog like on the page of the saga (`mediaMatchesItem`), so one the catalog holds links to its page, and one only Wikidata knows is a name, because no library can hold it. The page lists up to five sagas, the nearest to be finished first, and up to six works of each, and counts the rest.

**Privacy.** The candidates come from the **catalog**, which holds the data of the providers and **no one's library**, and the person is the one of the verified session: a title appears because of its genres or its saga and never because of what somebody else has. The library of another person does not say what this person likes, does not start their sagas and does not hide a title from them; an integration test of each is written. No count or ranking is made from other people's data.

## What is not in this ticket, and why

- **What other people search or add** needs the social graph (SAG-21) and the trending data (SAG-23), and the privacy rules of each entry. It is the signal that would use other people's data, so it waits for them.
- **The recommendations of the providers** (TMDB `/recommendations` and `/similar`) would find titles we do not hold yet, which is what the catalog lacks. They need the TMDB token, a call per title, and the terms of ADR-016 (what may be kept, for how long, and what must be credited), which were not read for this use. It is the next step if the catalog turns out too small, and a ticket of its own.
- **A section inside the search.** The search has its own job, and a person who has not searched for anything still has a taste.

## Alternatives considered

- **Pick the candidates from TMDB by genre** (`/discover`). More to offer, and a token, a call per visit or a job, and the 6-month rule. Left for a ticket of its own.
- **A score with weights of many signals** (year, type, creators, popularity of the genre). More to explain and to test with a catalog this small. The reason is one line of text that a person can check against what they scored.
- **Count a planned title as a signal.** A person plans what they have not seen; it says nothing about what they like.
- **Recommend only inside the format of the last thing finished.** A person who finishes an anime often wants a manga of the same genre; the genres are the same for every format (ADR-024), so the offer is not narrowed.

## Consequences

**Good**

- A person with a few scores sees titles that fit them, with the reason, and the works they lack of their sagas, with no call to anybody and no new data.
- It grows by itself: every title anyone opens joins the catalog, and every genre the job fills (ADR-024) makes more titles offerable.
- No migration and no new variable.

**To watch**

- **The catalog is small**, so the page can be nearly empty at first. It says so, and offers the search.
- **The query reads the catalog with `jsonb_exists` over the genres**, with no index of their own: at this size it is a scan. If the catalog reaches many thousands of titles, a GIN index on `media_items.genres` is the next step. It was **not measured** against the real database.
- **The query of the sagas matches every work of every published saga on each visit** (about 160 works with 21 sagas), by the rule of the page of the saga. **Not measured** in production either.
- **A planned title counts for nothing, even if it has a score.** The library keeps the score of an entry when its status changes, so a planned entry can have one; here it is ignored on purpose, because planning says nothing about what a person liked. Whether that case is common was not measured.
- **The weights (+0.5, +0.2, -0.3) are a first guess**, written to be changed in one place and checked with the owner's real library.

## Facts that were checked

No third party's terms were read for this decision: no provider is called. The behaviour of each rule is written as a test against a real Postgres (`db/recommendations.integration.test.ts`). **Not verified:** how the offer looks with the real library of the owner, and the time of the two reads in production.
