# Backups: how they work, how to set them up, how to restore

Part of SAG-135 (finding S-7 of the [security review](reviews/2026-11-security-review.md)) and [ADR-036](adr/036-daily-encrypted-database-copy.md). Read the [incident plan](incident-plan.md) first if something is wrong right now.

## What protects the data

| Layer                         | Window                           | Who does it                       | Good for                                                                   |
| ----------------------------- | -------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Neon history (Free plan)      | **6 hours**                      | Neon                              | A mistake noticed within hours. Restore to a point in time (incident plan) |
| Neon snapshot before a change | Until the next snapshot          | The owner, before a migration     | A migration that changes or deletes data                                   |
| **Daily encrypted copy**      | One copy a day, kept **30 days** | GitHub Actions, `database-backup` | A mistake noticed days later, or a lost Neon project                       |

The worst case with the daily copy is **up to 24 hours of changes lost** (the data between the last copy and the problem). Neon's own history can bring back the last 6 hours on top of that.

The copy holds personal data (accounts, libraries, who follows whom), so it is **always encrypted** before it leaves the runner, to a public key. The private key is only with the owner. A person who stole every GitHub secret still could not read a copy.

## Before a migration that changes or deletes data

Migrations are applied by hand (ADR-002). Adding a nullable column does not need this. Dropping or rewriting a column, a table or rows does.

1. In the Neon console, open the project and look for **Backup & restore** (the menu names change), then **Snapshots**, and create a snapshot of the production branch. The Free plan includes 1, so Neon may ask you to delete the previous one first.
2. Apply the migration (`npm.cmd run db:migrate` with the direct string in your terminal, as in the handoff).
3. Check the site. If it is wrong, restore from the snapshot (Neon console) the same day.

## One-time setup (the owner, about 30 minutes)

Nothing here is pasted in a chat. Every secret goes straight from where it is shown to where it is stored.

### 1. A key pair for the copies

In PowerShell (if `gpg` is not recognised, use `& "C:\Program Files\Git\usr\bin\gpg.exe"` instead of `gpg`):

```powershell
gpg --quick-generate-key "SagaShelf backup" default default never
```

It opens a window asking for a **passphrase**. Choose a long one and save it in your password manager. If you lose the passphrase or the private key, the copies **cannot be opened**.

Then save the private key in your password manager as a file or a note, and remove the file:

```powershell
gpg --armor --export-secret-keys "SagaShelf backup" > backup-private-key.asc
# store its contents in the password manager, then:
Remove-Item backup-private-key.asc
```

And copy the **public** key to the clipboard, for step 5:

```powershell
gpg --armor --export "SagaShelf backup" | clip
```

### 2. A read-only person in the database

In the Neon console, SQL Editor, on the **production** branch. Replace the text between `<>` with a long random password (make it in the password manager; do not use `DATABASE_URL`'s password) and with the name of the database (it is in your connection string, after the last `/`):

```sql
CREATE ROLE backup_reader WITH LOGIN PASSWORD '<a new long password>';
GRANT CONNECT ON DATABASE <database name> TO backup_reader;
GRANT USAGE ON SCHEMA public, drizzle TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO backup_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_reader;
```

The role is made with SQL on purpose: a role made in the Neon console becomes a member of `neon_superuser`, which is far more than reading ([Neon docs](https://neon.com/docs/manage/database-access), read 2026-11-05). This role can read every table and change nothing, so a leaked backup secret cannot delete data. The last two lines make the tables of future migrations readable too, as long as the same Neon role applies the migrations. Build its address from your **direct** Neon connection string (the one **without** `-pooler` in the host): change the user to `backup_reader` and the password to the new one. This is `BACKUP_DATABASE_URL`.

### 3. A place for the copies

In Cloudflare, **R2**: create a bucket (for example `sagashelf-backups`, Standard storage). Cloudflare may ask for a payment method to turn R2 on; its price page lists a free tier of 10 GB-month of storage and free egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/), read 2026-11-05), and a daily copy is a few megabytes. Whether a card is needed was not confirmed.

- **R2, Manage API tokens, create a token** with **Object Read & Write**, only for this bucket. Keep the Access Key ID and the Secret Access Key, and note the **account id**.
- **Bucket, Settings, Object lifecycle rules:** add a rule that **deletes objects after 30 days**.

### 4. Check the role cannot write

With the `backup_reader` address in your terminal only (never in a file):

```powershell
$env:DATABASE_URL = "<the backup_reader address>"
docker run --rm -e DATABASE_URL postgres:18 sh -c 'psql "$DATABASE_URL" -c "delete from users"'
Remove-Item Env:DATABASE_URL
```

The expected answer is `permission denied for table users`. If it says `DELETE 5`, stop: the role is wrong (and your data is gone: restore from the snapshot or the Neon history now).

### 5. The secrets in GitHub

GitHub, the repository, **Settings, Secrets and variables, Actions, New repository secret**. Six of them:

| Name                          | Value                                       |
| ----------------------------- | ------------------------------------------- |
| `BACKUP_DATABASE_URL`         | The `backup_reader` direct address (step 2) |
| `BACKUP_GPG_PUBLIC_KEY`       | The public key from the clipboard (step 1)  |
| `BACKUP_R2_ACCOUNT_ID`        | The Cloudflare account id                   |
| `BACKUP_R2_BUCKET`            | The bucket name                             |
| `BACKUP_R2_ACCESS_KEY_ID`     | From the R2 token                           |
| `BACKUP_R2_SECRET_ACCESS_KEY` | From the R2 token                           |

### 6. The first run and the restore test

1. GitHub, **Actions, Database backup, Run workflow**. It should finish green in a few minutes, and a file `sagashelf-<date>.dump.gpg` appears in the bucket. If it fails, GitHub also emails you. Send me the text of the error (it does not contain the secrets).
2. Do the restore test below **once** with that real copy. The ticket is not done until you have.

## Restore from a copy

Always restore into a **new, empty** database first, never over production.

**Test it on this computer (needs `npm run db:up`):**

1. Download the file from the R2 bucket (dashboard, the bucket, the file, Download) to an empty folder.
2. Decrypt it (asks for the passphrase):

   ```powershell
   gpg --output restored.dump --decrypt sagashelf-<date>.dump.gpg
   ```

3. Load it into a new local database and look inside:

   ```powershell
   docker exec sagashelf-db-1 psql -U sagashelf -d postgres -c "create database restore_check"
   docker cp restored.dump sagashelf-db-1:/tmp/restored.dump
   docker exec sagashelf-db-1 pg_restore -U sagashelf -d restore_check --no-owner /tmp/restored.dump
   docker exec sagashelf-db-1 psql -U sagashelf -d restore_check -c "select count(*) from users"
   ```

   The count must match what production had that day.

4. **Delete everything**, because it is real personal data on your computer:

   ```powershell
   docker exec sagashelf-db-1 psql -U sagashelf -d postgres -c "drop database restore_check"
   docker exec sagashelf-db-1 rm /tmp/restored.dump
   Remove-Item restored.dump, sagashelf-<date>.dump.gpg
   ```

**To bring data back into production:** make a new database or branch in Neon, load the copy there with `pg_restore` (direct address, in your terminal), compare, and then copy back only what is missing or swap the address. Ask for help before doing this; it depends on what was lost.

## Looking after it

- A failed run emails you. A run that never happens does not: look at **Actions, Database backup** once a month, and at the bucket for a file from this week.
- In a public repository GitHub turns off scheduled workflows after 60 days without repository activity ([GitHub docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), read 2026-11-05). The project is active, but if it is ever left alone, turn the workflow on again in the Actions tab.
- If the private key or the passphrase might have leaked: make a new key pair (step 1), replace `BACKUP_GPG_PUBLIC_KEY`, and delete the old copies from the bucket.
- If `BACKUP_DATABASE_URL` might have leaked: reset the password of `backup_reader` in Neon and replace the secret.
