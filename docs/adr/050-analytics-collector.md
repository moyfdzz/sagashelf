# ADR-050: The analytics collector writes straight to Postgres, with a daily salt

- **Status:** Accepted
- **Date:** 2026-11-12
- **Implementation:** Partial (SAG-24: the collector and its tables; the tracker, the rollups, the owner opt-out and the privacy text come in the next pull requests of the same ticket)
- **Tickets:** SAG-24

## Context

[ADR-009](009-analytics-cookieless.md) decided on cookieless, first-party analytics and left three things open: where the events are kept so the database can sleep, how the visitor hash gets its daily salt, and whether the city is worth storing. This ADR settles them for the first part of SAG-24, the collector.

## Decision

- **One row per event, straight to Postgres.** `/api/collect` validates the event and inserts one row into `analytics_events`. There is no buffer between the two. The cost is known from ADR-009: a write keeps the Neon compute awake, and the Free plan has 100 compute hours a month (read 2026-10-21, see ADR-009). With the traffic of a personal portfolio the database still sleeps between visits. The real compute hours are watched for a few weeks after the tracker ships; if the database no longer sleeps, a buffer goes in its own ticket and its own ADR, after reading the limits of the service it would use.
- **The salt of the day lives in the database.** `analytics_salts` holds one random value per UTC day. The first request of the day stores it and the rest read it; the statement also deletes the salts older than yesterday, so a hash of an earlier day cannot be recomputed from anything that is kept. No Workers secret is needed. Each isolate keeps the salt of the day in memory, so most events cost one statement.
- **The visitor is the first 128 bits of SHA-256 over the salt, the address and the browser name**, in hex. The address and the browser name are read in the Worker, hashed and dropped: no column holds them (a test asserts the table has no column for an address, a city, a user or a browser name).
- **Place: country and region only.** The city is not stored. The privacy of the visitor is the reason: with a small city, "city + day + browser" comes close to naming a person, and with the low traffic of the site a count per city would be a handful. A city can be added in a ticket of its own, with its text in the privacy policy. Cloudflare gives `request.cf.country` (two letters) and `request.cf.region` (the name of the first-level region); both are `string | null` and the page says no more about when they are missing (<https://developers.cloudflare.com/workers/runtime-apis/request/>, read 2026-11-12, last updated by Cloudflare on 2026-11-02). `XX` and `T1` are not described there and are not kept.
- **What an event holds:** the kind, the path (no query string, no fragment), the visitor hash, and by kind: milliseconds of a visible tab, the type of a search (never its text), the class and host of the referrer (never its path or query), the three UTM values, the country, the region and mobile or desktop.
- **Order of the checks:** only `POST`, size and `Origin`, rate limit, Do Not Track, Global Privacy Control, robots and a request without the address Cloudflare sets (answered as if counted, nothing kept), then the body. The robots filter uses `isbot` plus the names of headless browsers and Lighthouse; a request with no browser name is not counted. Without `CF-Connecting-IP` there is no visitor to tell apart, so nothing is kept.
- **The salt is pruned by the clock of the database,** not by the day the Worker says, so a Worker with a wrong clock cannot delete the salt other Workers still use.
- **Its own rate limit,** `COLLECT_LIMITER`, 60 a minute per caller. A visitor sends a page view and a time on page for every page, and the 30 a minute of the write endpoints would drop events of a person who browses fast.
- **Every answer is empty** (`204`, or the error status) and uncached, because `sendBeacon` ignores it.

## Alternatives considered

- **A buffer in front of Postgres** (a Cloudflare queue or store, flushed by the Cron handler). It lets the database sleep with heavy traffic, but it adds a service, limits not yet read and a place where events can be lost. Not now; the cost of writing straight is measured first.
- **Counters in the memory of the Worker.** An isolate is recycled at any moment and the counts would be lost. Rejected.
- **The salt as a Workers secret.** It needs a rotation job and a secret to keep. The table does it with the one statement that already runs. Rejected.
- **Storing the city.** Possible, not illegal by itself (the Mexican personal data law, in force since 2025-03-20, defines personal data as information about an identified or identifiable person: article 2, fr. V, read 2026-11-12 on <https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo125102.html>), but it makes "no personal data" harder to defend and it adds little for a site with few visits. Left for a later ticket.

## Consequences

**Good**

- Traffic can be counted without cookies, an address or a user id in the table.
- Nothing new to run: one table, one route, no secret, no job yet.

**Costs and risks**

- Every counted event is a database write. If traffic grows, the Neon compute hours are the limit to watch (ADR-009).
- **A public beacon can be forged.** The collector refuses a page of another site (`Origin`) and limits each caller, but anyone can send events from a script, and the events of the funnel (`signup`, `add_to_library`, `follow`) have no server-side proof that they happened. The numbers are a measure of use, not an audit; the figures that must be exact (users, entries, follows) come from their own tables in the admin dashboard (SAG-26).
- A visitor on two days counts as two, and a visitor who changes browser or network counts as two on the same day. Counting without cookies is approximate.
- Two requests of the first moment of a day can both miss the salt: the first call returns nothing and the route asks once more.
- The new rate limit is a change of `wrangler.jsonc` and needs its own namespace ids.
- The migration is applied by hand in production (`0033`). Until it is, the collector answers 500 and the tracker (next pull request) is not shipped, so nothing is lost.

## Open questions

- Whether the compute hours stay under the Free plan once the tracker is live (measure for a few weeks).
- Whether the text of `/privacy` needs the address and the way to use the ARCO rights that article 15 of the law asks for in an aviso de privacidad: read in the part of the law that could be read, not settled here. It belongs to the privacy-policy pull request of SAG-24, with a legal review.

## References

- [ADR-009](009-analytics-cookieless.md), [ADR-007](007-background-work-cron-and-outbox.md).
- Cloudflare, `IncomingRequestCfProperties`: <https://developers.cloudflare.com/workers/runtime-apis/request/> (read 2026-11-12).
- Ley Federal de Protección de Datos Personales en Posesión de los Particulares, articles 2, 7, 9, 15 and 16, text in force: <https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo125102.html> (read 2026-11-12, articles 1 to 50). The PDF of <https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf> could not be read.
