# ADR-035: Only a person with a session saves a title

- **Status:** Accepted
- **Date:** 2026-11-04
- **Implementation:** Done (SAG-130)
- **Tickets:** SAG-130, SAG-29, SAG-188, SAG-239
- **Related:** [ADR-017](017-media-pages-and-image-proxy.md) (this replaces its choice that anyone may save a title by opening it), [ADR-004](004-search-strategy.md), [ADR-006](006-security-model.md), [ADR-011](011-edge-security-and-domain.md)

## Context

A title that only a provider knows is saved when somebody opens it, through `/media/open?provider=...&id=...` (ADR-017). ADR-017 chose a `GET` that writes on purpose, so that a result opens without JavaScript, and said the damage was bounded: a real title from a fixed provider, once, under a rate limit.

The security review (SAG-29, finding S-1) looked at that bound again. The route needs no session, a `GET` has no `Origin` to check, and the only limit was the search limiter (60 a minute per IP address and per Cloudflare location). The `API Burst` rule of the WAF covers `/api/*` only, and the Free plan has one rate rule. So anybody could fill the database with titles, or spend the quota of a provider, with a loop over external ids, and a page on another site could make a visitor's browser do the same with an image or a link. The database has a limited size on the Neon Free plan (ADR-012), and a saved title cannot be traced back to who caused it.

## Decision

- **A title we already hold opens for everybody**, with or without a session, as before. No limit is spent.
- **A title that only a provider knows is saved only for a person with a session.** A visitor who opens one is sent to `/sign-in` with the same address as the way back (`signInPath`), and when they return the title is saved and opened. Nothing is saved, and no provider is called, for a visitor.
- **The person is limited by a binding of its own, `OPEN_LIMITER`: 10 a minute, counted per person** (the key is `media-open:<user id>`, plus the caller the rate limiter adds). It is declared in `wrangler.jsonc` for production (namespace `1004`) and for previews (`2004`), like the other three. Nobody opens 10 untitled results a minute by hand, and a loop does.
- **Three routes share that one budget** (SAG-188, 2026-11-09): `/media/open`, `/library/add-external` and the confirm step of `/settings/import` all spend `OPEN_LIMITER` with the key `media-open:<user id>` (plus the caller, as above; written once in `server/open-limit.ts`), one unit for each call to a provider. The import asks for a unit before each new title and stops at the first refusal: the titles it did not ask for stay "pending", and another import brings them. A title we already hold spends nothing in any of the three. Before this, add-external counted per address with the search limiter and the import only had the write limiter, which allowed up to 180 new titles a minute for one person.
- **A daily budget in the database, by person only** (SAG-239, 2026-11-09). The binding counts per person **and** per address **and** per Cloudflare location, so a person who changes address gets a new minute budget each time. For the limits that protect the quota of a provider and the size of the database, that is not enough. `server/open-limit.ts` now spends two limits, in this order, and every route that saves a title from a provider calls it with the person's id:
  1. `OPEN_LIMITER`, the binding (10 a minute, per person and address): cheap, per address, in front. It stops a burst before the database is asked and stays approximate.
  2. `claimTitleFetch` in `server/db/title-budget.ts`: **300 titles a UTC day for one person, whatever the address.** The count is in two columns of `users` (`title_fetches_day`, `title_fetches_count`, migration `0030`), taken with one atomic statement, the way the picture tries of ADR-037 are. It answers `429` with `Retry-After` set to the seconds until UTC midnight, or `403` for an erased account.

  The order of the checks of the routes does not change: the title we hold, then the session, then the limit, then the provider. A fetch that fails after its unit was taken is not given back. The other limiters (`WRITE_LIMITER`, 30 a minute, and the search one) stay as they are: they protect the cheap path and do not guard a quota. The counter holds no personal data, so the erasure and the export do not list it, like the picture tries.

  **Cost:** one extra statement (a subrequest on the Worker) for each call to a provider, none when we already hold the title. `/media/open` and `/library/add-external` add 1 to a request that already makes 2 to 6; an import step asks for at most `maxNewTitles` (6) titles, so it adds at most 6 to the 2 to 6 each already costs. That is about 45 of the 50 subrequests in the worst case. It was calculated from those numbers, not measured under a full load.

- The sign-in redirect answers `private, no-store`, since it depends on who is asking.
- `app/routes/read-loaders.test.ts` lists the route as a page for visitors, and `app/routes/media.open.test.ts` keeps the order: the title we hold first, then the session, then the limit, then the provider.

## Alternatives considered

- **Show the data of the provider to a visitor without saving it.** It keeps the old experience, but it needs a page that renders a title from the provider with nothing in the database, with its own cache and its own rules for the license of the data. It is a feature, not a fix. Left for its own ticket if visitors ask for it.
- **Reuse `WRITE_LIMITER` (30 a minute).** It needs no change in the configuration, but it is the limit of everything else that writes. A limit of its own can be tuned for this one use.
- **A daily cap of titles saved by one caller.** The Workers Rate Limiting binding only counts in windows of 10 or 60 seconds, so a daily cap needs a counter in the database, with a migration and a table. It was not chosen then: this ADR bounded the **rate** and not the **total** (see Consequences). SAG-239 chose it afterwards, as a column pair in `users` and not a table (see Decision).
- **A Turnstile on the call.** Clerk already puts one in front of sign-up, and a `GET` that is followed by a redirect cannot carry a challenge well. The unused `server/turnstile.ts` was removed in SAG-132.
- **Make the call a `POST`.** ADR-017 rejected it because results opened without JavaScript would break; it still would.

## Consequences

**Good**

- A visitor, a crawler or a page on another site can no longer make us save a title or call a provider. The cost of the call for a visitor is one lookup of a title we may hold.
- A person who saves too fast gets a `429` of their own, and does not use up their other limits.

**Costs and risks**

- **A visitor who opens a title we do not hold has to sign in first.** It is one more step for somebody who only wanted to look, and it changes what ADR-017 promised.
- **The total is bounded per day since SAG-239 (300), not forever.** Originally one person with an account could save up to 10 titles a minute, 14,400 a day, until somebody notices; now at most 300 a day. Accounts are protected by Clerk's bot checks, and the administrator can delete the person in Clerk, but a saved title keeps no trace of who saved it, so deleting the account does not remove them. A daily cap, or a column that says who saved a title, would be a migration.
- A visitor who sends many ids still costs one database read each, the same as any public page.
- `OPEN_LIMITER` must exist in every environment. `getOpenLimiter()` throws a clear error if it does not, like the other three.
- Not tried: the whole path through Clerk (sign in, come back, save). The tests use a simulated session and database.

## Open questions

- Whether visitors should see a title from the provider without signing in (a new ticket if so).
- Whether the 300 a day fits real use (a big import over several days), and whether a record of who saved a title is worth a migration if abuse is ever seen.

## References

- Security review, finding S-1: [`../reviews/2026-11-security-review.md`](../reviews/2026-11-security-review.md).
