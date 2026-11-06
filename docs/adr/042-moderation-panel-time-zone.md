# ADR-042: The moderation panel shows times in Monterrey

- **Status:** Accepted
- **Date:** 2026-11-06
- **Implementation:** Done (SAG-154), not tried in production yet
- **Tickets:** SAG-154
- **Related:** [ADR-039](039-moderation-panel.md), [ADR-040](040-warn-suspend-ban.md)

## Context

Every date of the app is written in UTC (`defaultTimeZone` in `app/lib/format.ts`). The server and the browser must print the same text while hydrating, and the app does not know the zone of each person. The owner, who is the only administrator, tried the moderation panel on 2026-11-06 and read 22:35 where the clock in Monterrey said 16:35.

## Decision

The three lists of the moderation panel (the open reports, the suspended or banned accounts and the refused uploads) show their times in `America/Monterrey`, through one function, `formatPanelTime` of `useFormatters`, and one constant, `adminTimeZone`. The zone is fixed, so the server and the browser still print the same text.

Every other page keeps UTC. Mexico has had no daylight saving time since 2022 (UTC-6 all year), and the zone database would follow a change without touching the code.

The same ticket shows the internal note of a restriction in the list of suspended or banned accounts. It is read from `audit_log.metadata.note` in the same statement as the list, taking the last row of the action that matches the state now (`account.suspended` or `account.banned`), so a note of an older restriction that was lifted is never shown on a new one. The page is for administrators only and the person never sees the note.

## Alternatives considered

- **UTC everywhere, as before.** Safe, but the owner has to subtract six hours at every look.
- **Monterrey for the whole app.** It would show wrong times to anyone outside that zone, for example in Notifications.
- **A zone for each person, chosen in the settings.** The right answer if more people read times, but it needs a new column, a setting and a way for the server to know the zone before it renders. Not needed while one person reads the panel.
- **The zone of the browser.** The server renders first with another zone and the page would not match when it hydrates.

## Consequences

- Times in the panel are right for the owner and wrong for an administrator in another zone. If the panel gets more administrators, this decision should be replaced by a zone for each person.
- The panel and the rest of the app now show different zones. The panel does not write the zone next to the time.
- `audit_log` has no index on `target_id`. The list asks for the last row of each restricted account, which is fine at this size. An index would be the answer if the table grows.

## Open questions

- Whether Notifications and the rest of the app should also follow a zone chosen by the person. Not decided; it needs its own ticket.

## References

- Mexico ended daylight saving time in October 2022. This is the author's knowledge, **not** checked against a source on a date: the code does not depend on it, because it uses the zone name.
