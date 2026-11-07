# ADR-044: A contact page, with the messages kept in the database

- **Status:** Accepted
- **Date:** 2026-11-06
- **Implementation:** Done (SAG-110, two PRs), not tried in production yet
- **Tickets:** SAG-110
- **Related:** [ADR-014](014-account-deletion-erases-everything.md), [ADR-038](038-reports-and-picture-records.md), [ADR-039](039-moderation-panel.md), [ADR-042](042-moderation-panel-time-zone.md)

## Context

The only way to reach the owner was the address printed in the legal pages (`contact@sagashelf.app`, forwarded by Cloudflare). That address is public text that anybody can collect, it says nothing about who writes or why, and a person has no way to tell the owner about a problem from inside the app. The ticket left open where the messages should go: an email to that address, or the database with a state in the administration. The owner chose on 2026-11-06 to keep them in the database. An email would need the Worker to send mail, which the app does not do (a warning is a notification, not an email), and a message that lands in a spam folder is lost.

## Decision

**A public page `/contact`** with the kind of message (feedback, a problem or help), a text of 1 to 2000 characters and, for a visitor only, an optional email to be answered at. A signed-in person does not type an address: they are answered through their account, and the server never keeps an address for them (a check of the table says so).

**The messages are rows of `contact_messages`** with a state, `new` or `handled`. The administration reads them at `/admin/messages` (SAG-110, first PR): the new ones first, who wrote it (the username, or "Visitor"), the time in Monterrey (ADR-042), the text as plain text, and buttons to mark it handled, new again, or delete it after asking. Each change is audited with the kind and the id.

**A new message notifies each active administrator** with a row of `notifications` of the type `contact.created`, written in the same statement that stores the message. The payload is the kind only. The text, the address and the author are never copied into a notification or the audit log, so they exist in one place that is erased.

**Protection against spam**, in the order the route asks: the size of the body and the `Origin` (`checkWrite`), who is writing (`getOptionalUser`), the rate limit keyed by the person, or `visitor` for everybody who is not signed in, and then the form. A form field that only a bot fills in (`website`, hidden from people with `display: none`) is answered as if the message had been sent, and nothing is kept. A daily cap is counted in the same statement that stores the message: 5 for a signed-in person, and 50 for all the visitors together, since a visitor has no id and the address of a caller is not kept. A message over the cap is refused with 429 and the text typed is given back. There is no CAPTCHA: it would need another origin in the security policy.

**What was typed comes back when the form is refused,** since the form is a whole page post and a mistake in the address must not cost the message.

**Personal data.**

- A message sent with an account is erased with the account (`contact_messages.user_id` is in `erasedColumns`) and is in the data export. A visitor's message is linked to nobody, so it is in neither.
- Every message is deleted 90 days after it was sent, handled or not, by the second Cron Trigger. That is one more statement, so the cron goes from 24 to 25 of its 50 subrequests.
- The privacy policy says all of this, and its date changed.

**A suspended or banned person** is sent to `/account-restricted`, as on every page that looks at who is signed in (`getOptionalUser`). That page already shows the contact address, so they can still write by email.

**The page is not indexed and is never kept by a shared cache.** The footer links to it from every page.

## Alternatives considered

- **Only the email address.** No new data and no new page, but it says nothing about who writes, cannot be sorted or marked, and the address stays public text. It was the simple option, and it stays as a way to write.
- **Send an email from the Worker for each message.** It needs a mail service and a verified sender, and the message lives in the owner's inbox, outside the erasure and the 90 day limit.
- **A CAPTCHA.** Stronger against bots, but it loads a script and a frame from another origin, which the policy forbids without its own ticket and test. The trap field, the limits and the daily caps are enough at this size.
- **A limit for each address of a visitor.** It would mean keeping the IP of every caller. The shared cap of 50 a day gives the same protection to the owner without keeping it.
- **Keep the messages until somebody deletes them.** Personal text that nobody asked to keep. 90 days is enough to answer.

## Consequences

- The owner has a place to read what people write, and a notification when something arrives. Nothing sends an email: the owner has to look at the notifications or the page.
- One visitor can use all 50 messages of the day and block the other visitors until the next day. A signed-in person is not affected. If that happens, the cap or the protection has to change.
- A visitor who leaves no address cannot be answered. The page says so.
- The text of a message is shown only in the administration and in the export of the person who wrote it, and is deleted with the account or after 90 days.
- `ON CONFLICT` and the rest of the statement run on the Neon driver in production, and were only tried with `pg` locally.

## Open questions

- Whether the messages need a search or a filter in the administration, if they become many. Not needed with a limit of 50 a day.
- Whether a person who is suspended or banned should be able to appeal from the app. Today they use the email address.

## References

- ADR-038 and ADR-039 for the way reports reach the administrators, which this follows.
