# ADR-036: A daily encrypted copy of the database, kept outside Neon

- **Status:** Accepted
- **Date:** 2026-11-05
- **Implementation:** Done (SAG-135): the owner set it up on 2026-11-05 and a real copy was restored ([backups](../backups.md))
- **Tickets:** SAG-135, SAG-29
- **Related:** [ADR-006](006-security-model.md), [ADR-012](012-neon-over-supabase.md), [ADR-002](002-data-postgres-neon-drizzle.md)

## Context

ADR-006 named Neon's point-in-time restore as the answer to data loss. The security review (SAG-29, finding S-7) found that on the Free plan the history window is **6 hours**, and that the plan includes 1 manual snapshot (Neon docs, read 2026-11-04). A bad migration, a bug that deletes rows or an account erased by mistake can be undone only if it is noticed within 6 hours, and nothing else holds a copy. The database holds the viewing history, the libraries and the social graph of the people who signed up.

The owner has few users today and expects more. A backup that depends on the owner remembering, or on their computer being on, fails on the day it is needed.

## Decision

- **A daily copy, made by GitHub Actions** (`.github/workflows/backup.yml`, 04:23 UTC, also runnable by hand). It calls `scripts/db-backup.sh`, which runs `pg_dump` from the `postgres:18` image (the same major version as CI and local), checks that the archive really holds the `users` table, and encrypts it.
- **Encrypted to a public key (GPG).** Only the public key is in GitHub. The private key and its passphrase are in the owner's password manager. A person who stole every secret of the repository could not read a copy.
- **Stored in a Cloudflare R2 bucket**, not as a GitHub artifact: artifacts of a public repository can be downloaded by anybody with an account. The bucket has a lifecycle rule that deletes objects after **30 days**.
- **A read-only database role** (`backup_reader`, made with SQL and `SELECT` grants) is the only database credential in GitHub. A leaked backup secret cannot change or delete data. It uses the **direct** (not pooled) address.
- **A Neon snapshot before every migration that changes or deletes data**, by hand, as a step in [backups](../backups.md). Adding a nullable column does not need it.
- **The recovery window is stated as it is:** up to 24 hours of changes can be lost with the daily copy, and the Neon history covers the last 6 hours on top of that.

## Alternatives considered

- **A copy made by hand from the owner's terminal.** Cheaper to set up, but it fails silently when the owner forgets. Rejected by the owner in favor of automation.
- **A GitHub artifact as the store.** No bucket to set up, but visible to anybody with a GitHub account in a public repository, and kept 90 days at most. Even encrypted, personal data should not be placed there.
- **A paid Neon plan with a longer window.** Simplest to run, but it costs money every month and the window is still bounded; it does not protect against losing the Neon project. Left for later if the site grows (ADR-012).
- **A Worker cron that makes the copy.** A Worker cannot run `pg_dump`, so it would need to read every table by hand and write its own format. More code to maintain and test than one script.
- **A symmetric passphrase in a GitHub secret.** Simpler, but anybody who reads the secrets can decrypt every copy. The public key avoids that.
- **`pg_read_all_data` for the role.** Shorter, but Neon's staff have said that granting it is not supported (a 2024 community answer, not rechecked), so the role gets explicit `SELECT` grants.
- **A mutable bucket protected only by the lifecycle rule.** The API token of the workflow can also delete objects; locking the bucket against deletion (object lock) was not looked at. Left as an open question.

## Consequences

**Good**

- A mistake noticed days later, or a lost Neon project, can be recovered from a copy, with at most a day of changes lost.
- Nothing readable leaves the runner, and the credential in GitHub cannot write to the database.
- A failed run emails the owner.

**Costs and risks**

- **A new set of secrets in GitHub** (six, listed in [secrets](../secrets.md)) and a new thing that can break. A run that never happens sends no email: the owner looks once a month ([backups](../backups.md)).
- **If the private key or the passphrase is lost, the copies cannot be opened.** There is no way around that by design.
- **Personal data lives in a second place** (R2) for 30 days, encrypted. The privacy policy was not touched here; whether it should mention backups is the owner's decision with advice.
- **The restore was tried once against production, on 2026-11-05.** A run made by hand put a copy in R2; it restored into a local database with the same number of users and all 29 tables; the key and passphrase in the password manager opened it; and `backup_reader` was refused a delete on Neon. The scheduled run had not happened yet when this was written, and restores are not repeated automatically.
- The copy is up to 24 hours old. A copy every few hours is a change of the cron line if it is ever needed.
- The R2 free tier and what R2 asked for when it was turned on are described in [backups](../backups.md) with their dates. A saved card is behind it, so going over the free tier could be charged.

## Open questions

- Whether to lock the bucket so the workflow's own token cannot delete copies.
- Whether the privacy policy should say that encrypted backups are kept for 30 days.
- Whether a second person should be able to open the copies (a second key) if the site grows.

## References

- Security review, finding S-7: [`../reviews/2026-11-security-review.md`](../reviews/2026-11-security-review.md).
- Setup and restore: [`../backups.md`](../backups.md).
