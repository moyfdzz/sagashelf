# ADR-009: Cookieless first-party analytics with daily rollups

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Planned (SAG-24)
- **Tickets:** SAG-24, SAG-26, SAG-31

## Context

The owner wants to know how the site is used (traffic, where visitors come from, which flows work) without cookies for analytics, without third-party scripts, and without personal data. The privacy policy has to be able to say that plainly. The approach is the one the owner used in an earlier project.

## Decision

- **A tiny first-party tracker** sends events with `sendBeacon`: page views, engaged time (visible tab only), traffic sources (UTM parameters and referrer classes such as Google, social networks and direct), searches performed (the type only, never the text), the sign-up funnel, add-to-library and follows. It respects **Do Not Track and Global Privacy Control**.
- **A collector route** `/api/collect` validates events with Zod, filters bots, applies a rate limit, and takes the location (country, region, city) from Cloudflare's `request.cf`. The visitor is identified by a **hash with a daily rotating salt**, so the same person cannot be followed across days and **no IP address is stored**.
- **Retention:** raw events for 13 months, daily rollups by date and dimension forever. Rollups are computed by the shared Cron handler (ADR-007).
- **Owner opt-out:** a flag so the owner's own visits are not counted.
- **Reports** appear in the admin dashboard (SAG-26).
- **Documented in the privacy policy** (SAG-31).

## Alternatives considered

- **A third-party analytics product with cookies.** Rejected: it brings third-party scripts, consent banners and personal data.
- **A third-party cookieless analytics service.** Avoids cookies but still sends visitor data to another company and gives less control over funnels. Rejected to keep data first-party.
- **No analytics.** Simplest, but the owner could not tell whether the product is used. Rejected.
- **Storing IP addresses or long-lived visitor ids.** More precise, but personal data. Rejected.

## Consequences

**Good**

- Traffic, sources and funnels are measurable without cookies or personal data, and without a consent banner for analytics.
- Data stays in our own database.

**Costs and risks**

- Counting without cookies is approximate: a visitor on two days counts as two, and bot filtering is never perfect.
- Raw events grow the database, and Neon's Free plan has 1 GB per project (read 2026-10-21). Retention and rollups must keep the raw events well under that.
- **Writing one row per page view keeps the Neon compute awake.** It shuts down after 5 minutes without queries, and the Free plan has 100 compute hours a month, which a compute that never pauses would use up in about 18 days at 0.25 CU. The collector should batch its writes (for example buffer events and flush them from the Cron handler) instead of writing on every request.
- The rollup job competes for the 10 ms CPU budget of a Cron invocation on the Free plan (ADR-007) and may need to run in small steps.
- The only cookie the site sets is `locale`, a language preference (ADR-008). It is not used for analytics, and the privacy policy lists it.

## Amendment: Cloudflare Web Analytics in the meantime (SAG-51, 2026-10-26)

Cloudflare injects its Web Analytics beacon (`beacon.min.js`) into the pages of the production Worker, and the owner decided to keep it until SAG-24 ships. This is a third-party script, which this ADR avoids as the final design, so it is temporary.

- The privacy policy no longer says "no analytics": it says that Cloudflare Web Analytics measures visits and page speed, and what Cloudflare states it collects. The cookies text stays as it was, because Cloudflare states the beacon uses no cookies or `localStorage`.
- What Cloudflare states (read 2026-10-26): "It does not use any client-side state, such as cookies or `localStorage`, to collect usage metrics" and it does not fingerprint people by IP address or User Agent (<https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/>); it collects "the minimum amount of information - timing metrics" and "does not track individual end users across our customers' Internet properties" (<https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/>). The fields the beacon sends beyond timings were not found in the documentation. These are Cloudflare's own statements, not an audit. Its "no personal data" wording has an exception for visitors from the EU and the UK (<https://blog.cloudflare.com/the-rum-diaries-enabling-web-analytics-by-default/>).
- When SAG-24 ships: turn Web Analytics off in the Cloudflare dashboard and update the policy again.

## Open questions

- Whether `request.cf` city-level location is precise and stable enough to be worth storing, or whether country and region are enough.

## References

- Ticket SAG-24 (Linear)
