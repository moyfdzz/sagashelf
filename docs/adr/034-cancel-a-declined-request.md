# ADR-034: Cancelling a declined follow request, and no wait to ask again

- **Status:** Accepted
- **Date:** 2026-11-04
- **Implementation:** Done (SAG-123)
- **Tickets:** SAG-123
- **Related:** [ADR-032](032-follow-requests.md) (this replaces its 30-day wait), [ADR-031](031-social-graph.md)

## Context

ADR-032 kept a declined request as a row with `declined_at`, so the requester kept seeing "sent", "Cancel request" did nothing to that row, and asking again waited 30 days. Trying it in production with two accounts showed two problems:

- The Cancel button did nothing, yet the page said "Cancelaste tu solicitud". A notice that says something that did not happen.
- A person who declines by mistake cannot be asked again for a month, and the requester has no way to try. The owner decided that somebody who insists too much can be blocked, which is a better answer than a silent wait.

## Decision

- **Cancelling deletes the row, also a declined one.** The owner who declined is still told nothing, and the requester never learns that the request was declined (they see "sent" until they cancel it).
- **No wait.** After cancelling, the requester may ask again at once, and the owner then sees a new request. `askAgainAfterDays` is removed.
- **Asking again while a declined row exists changes nothing** and answers `requested`, as before. The way to ask again is to cancel first, which the page offers. The same holds for the request that "Accept and follow back" sends.
- **What limits insistence stays:** the cap of 60 follows and requests an hour, the cap of 100 requests sent, and blocking (a block removes the requests between the two).
- **The privacy policy** (`/privacy`) says that a declined request is kept as declined, and looks sent to the person who sent it until they cancel it, instead of "up to 30 days".

## Alternatives considered

- **Keep the 30 days and fix only the notice.** Honest, but it keeps the problem of a mistaken decline.
- **Let "Request" renew a declined row directly.** The same result without the extra step, but the requester would then be asked to ask again on a page that shows "sent", which tells them they were declined. Cancelling first reveals nothing.
- **Tell the requester they were declined.** Not done, for the reason in ADR-032: declining and ignoring tell nobody.

## Consequences

- A person who is declined can ask again as often as the caps allow. The owner has two answers to that: block, or ignore.
- A declined row now lives until the requester cancels it, the owner blocks them, or an account is erased. It is still part of the export (ADR-032) and of the account erasure.

## Open questions

- Whether the caps are enough against somebody who cancels and asks again over and over. Nothing has been seen in use; the next answer would be a per-pair cooldown, which this ADR chose not to add.

## References

- Trying SAG-108 in production with two accounts, 2026-11-04.
