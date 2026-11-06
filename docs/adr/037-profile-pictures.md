# ADR-037: Uploading a profile picture, stored in Clerk and checked before it is saved

- **Status:** Accepted
- **Date:** 2026-11-05
- **Implementation:** Done (SAG-109), not tried in production yet
- **Tickets:** SAG-109, SAG-141
- **Related:** [ADR-003](003-auth-clerk.md), [ADR-006](006-security-model.md), [ADR-014](014-account-deletion-erases-everything.md)

## Context

The picture of a profile was the one the account had in Clerk, and nobody could change it from the app. Letting people upload one means publishing images nobody has looked at, on public pages. The owner asked how that is usually kept safe against malicious files, pornography and images of minors, and chose the layers below on 2026-11-05.

## Decision

**Clerk stores the picture.** The Clerk instance serves only this app, so a picture there is a picture just for SagaShelf. `users.updateUserProfileImage` replaces it, and `users.avatar_url` gets the new address and Clerk's time at once, as a username does. Pictures keep coming from `img.clerk.com`, which the CSP already allows (SAG-138).

**The browser makes it small.** The Worker has too little CPU time to decode an image, so `app/lib/picture.ts` cuts the middle square at 512 px and sends a JPEG. Drawing it on a canvas also leaves out what the file carried, such as the place of a photo. A person who skips the page skips this, so nothing depends on it for safety.

**The server checks what arrives.** `POST /settings/avatar` asks for a session, the `Origin` and the write limit, and refuses more than 1 MB. It reads the type from the first bytes and accepts only JPEG, PNG and WebP. An SVG is refused because it can carry a script. No antivirus is used: the browser only ever shows the file as an image, from Clerk's domain.

**A moderation service answers before anything is saved.** `server/moderation/sightengine.ts` sends the picture to Sightengine with the model `nudity-2.1`. A score of 0.5 or more at `very_suggestive`, `erotica`, `sexual_display` or `sexual_activity` refuses it. Sightengine recommends no number and this one was not measured with real pictures, so it is a constant that can change. The levels below, such as a swimsuit, are allowed.

**It fails closed.** With no keys, a timeout, the limit of the plan or an answer that cannot be read, nothing is saved and the person is told to try later. With no keys the page does not offer the upload at all, which is the case in CI and in previews.

**Five tries a day for each person** (`users.avatar_uploads_count`, migration `0023`, in UTC). The free plan allows 500 operations a day and 2,000 a month, and each try costs one even if it is refused, so a try is not given back. It is one statement, so requests sent together cannot pass it.

**The rules are written down.** The community rules forbid sexual content of any person, whatever their age, and pictures of other people without their permission. A person's own normal picture is allowed from the age of 13, since the terms allow that age.

**The header shows it.** The picture replaces the word "Cuenta" on a wide screen, and the word stays as the name of the button. On a phone the row has no room, so it goes next to the link to the profile, inside the menu. It comes from the one read of the header (`findHeaderFacts`).

**Deleting an account deletes the picture first,** on its own, because Clerk does not say what happens to the file when an account is deleted. A refusal there does not stop the deletion.

**The export carries the address of the picture,** as it did, and not the file.

**The control of the file is hidden from the eye, and its label is the button (SAG-144).** The browser writes "Choose File" in its own language, which the page cannot translate. The control stays in the page for the keyboard and screen readers. Removing a picture asks first, with `ConfirmDialog`.

**A generated image is not a picture of the person (SAG-144).** After a picture is removed, or for an account that never had one, Clerk gives a generated image. `users.has_own_picture` (migration `0025`) follows `hasImage` of Clerk ("Returns `false` if Clerk is displaying an avatar for the user", read 2026-11-05) and `has_image` of the webhook, which is not in the pages read but is in the types of `@clerk/backend`. With it false, the page offers neither removing nor reporting the image. The column starts true for everybody and an event that does not say keeps what is there, because a mistake must lose a link to remove at worst, and never the link to report a real picture.

## Alternatives considered

- **R2, with a column of our own.** It would keep the address of visitors away from Clerk for uploaded pictures, but not for the others. It needs a binding, a column read by every query of a person, a route that serves files and its own deletion. Not worth it now.
- **Human review before publishing.** The strongest check, and the only one that would see a normal picture of a child. It needs a page of administration and the owner watching every upload. Rejected for now by the owner.
- **Forbidding every picture of a minor.** It cannot be enforced, and it would forbid a 15-year-old's own normal picture. Rejected by the owner.
- **Sightengine's model for minors.** It seems to need the Pro plan (the pricing page lists "Age Estimation" only there, 99 USD a month; the docs page of the model was not read). An estimate would still not decide what is allowed.
- **Google Vision or AWS Rekognition.** Both need a billing account, and their prices for this could not be read. AWS says its moderation does not detect illegal content such as CSAM.

## Consequences

- People can choose their picture, and a new provider receives every picture that is tried. The privacy policy says so.
- **This does not make it impossible.** The check makes mistakes both ways, it does not look for known illegal material, and a normal picture of a child is not detected. Reports and the record of uploads came with [ADR-038](038-reports-and-picture-records.md). Scenario G of the [incident plan](../incident-plan.md) says what to do.
- Clerk's backend answers for this were read in its documentation and mocked in the tests. **Not stated by Clerk, and to be tried in production:** the accepted size and types, what `image_url` becomes after removing a picture, whether `user.updated` is sent, and whether signing in with Google brings back the old picture.
- Pictures are served from `img.clerk.com`, so the browser of whoever sees one still connects to Clerk.
- **The migration must go before the merge.** Without it the pages keep working, but an upload fails and so does the erasure of an account, in the settings and on the `user.deleted` event, since it resets the new columns. The account would be gone from Clerk and still here.

## Open questions

- Matching against lists of known material, and what must be reported and kept, with legal advice: SAG-141.
- Whether 0.5 is the right score, once real pictures have been tried.

## References

Read on 2026-11-05.

- Clerk: [updateUserProfileImage](https://clerk.com/docs/reference/backend/user/update-user-profile-image), [deleteUserProfileImage](https://clerk.com/docs/reference/backend/user/delete-user-profile-image), [system limits](https://clerk.com/docs/guides/how-clerk-works/system-limits) (1000 requests per 10 seconds in production; the picture endpoints are not listed, so the general limit applies).
- Sightengine: [nudity model](https://sightengine.com/docs/advanced-nudity-detection-model-2.1), [pricing](https://sightengine.com/pricing) (free plan of 2,000 operations a month and 500 a day, no time limit; one operation per image; 12 MB), [retention](https://sightengine.com/faq/data-retention-after-processing) ("By default, images, videos and audios are deleted after processing"), [location](https://sightengine.com/faq/data-processing-location) (EU, Canada, US), [terms](https://sightengine.com/policies/terms) (training only on what is sent through its Feedback API, which is not used here), [DPA](https://sightengine.com/policies/dpa) (covers free accounts).
- Cloudflare: [CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/).
- AWS: [content moderation](https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html).
