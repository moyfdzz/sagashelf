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

In PowerShell, outside the repository (your home folder is fine). This computer has no `gpg` on its path, so the commands use the one that comes with Git:

```powershell
$gpg = "C:\Program Files\Git\usr\bin\gpg.exe"
& $gpg --quick-generate-key "SagaShelf backup" default default never
```

It opens a window asking for a **passphrase**. Choose a long one and save it in your password manager. If you lose the passphrase or the private key, the copies **cannot be opened**.

If it answers `failed to start keyboxd` or `No Keybox daemon running`, GnuPG 2.4 wrote `use-keyboxd` into a new `.gnupg\common.conf`. Empty that file and run the command again:

```powershell
Clear-Content "$HOME\.gnupg\common.conf"
```

Then save the private key in your password manager as a note, with its `BEGIN` and `END` lines, and remove the file. Use `--output`: in Windows PowerShell, `>` writes UTF-16, which `gpg` may not read back.

```powershell
& $gpg --armor --output backup-private-key.asc --export-secret-keys "SagaShelf backup"
notepad backup-private-key.asc
# store all of it in the password manager, close Notepad, then:
Remove-Item backup-private-key.asc
```

And copy the **public** key to the clipboard, for step 5. The whole block goes in the secret, with its `BEGIN` and `END` lines:

```powershell
& $gpg --armor --export "SagaShelf backup" | clip
```

### 2. A read-only person in the database

In the Neon console, SQL Editor, on the **production** branch. `production` is the name of the branch, not of the database; `SELECT current_database();` gives the name of the database. Replace **both** texts between `<>`: the first with a long random password of letters and numbers only (make it in the password manager; do not use `DATABASE_URL`'s password; a symbol such as `@` or `/` would break the address), the second with the name of the database:

```sql
CREATE ROLE backup_reader WITH LOGIN PASSWORD '<a new long password>';
GRANT CONNECT ON DATABASE "<database name>" TO backup_reader;
GRANT USAGE ON SCHEMA public, drizzle TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO backup_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_reader;
```

The role is made with SQL on purpose: a role made in the Neon console becomes a member of `neon_superuser`, which is far more than reading ([Neon docs](https://neon.com/docs/manage/database-access), read 2026-11-05). This role can read every table and change nothing, so a leaked backup secret cannot delete data. The last two lines make the tables of future migrations readable too, as long as the same Neon role applies the migrations.

The editor keeps the statements that worked before one that failed. If `role "backup_reader" already exists` appears on a second try, do not make it again: set the password with `ALTER ROLE backup_reader WITH PASSWORD '<the password>';` and run the `GRANT` and `ALTER DEFAULT` lines, which are safe to repeat. To check the result:

```sql
SELECT table_schema, privilege_type, count(*)
FROM information_schema.role_table_grants
WHERE grantee = 'backup_reader'
GROUP BY 1, 2
ORDER BY 1, 2;
```

Only `SELECT` may appear, in `drizzle` and in `public`.

**The address is not given by Neon: you edit it by hand.** **Connect** gives the address of your main role. Copy it with **Connection pooling** off (no `-pooler` in the host), paste it into a new note of your password manager, and change only what is between `//` and `@`. Before and after:

```text
postgresql://<main role>:<main password>@<host without -pooler>/<database>?sslmode=require
postgresql://backup_reader:<backup_reader password>@<host without -pooler>/<database>?sslmode=require
```

This is `BACKUP_DATABASE_URL`.

### 3. A place for the copies

In Cloudflare, **R2**: create a bucket (for example `sagashelf-backups`, Standard storage), with no public access. On this account on 2026-11-05, R2 did not ask for a new card: it said it would use the one already saved. An account with no card was not tried. Its price page lists a free tier of 10 GB-month of storage and free egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/), read 2026-11-05), and the first copy was about 200 KB.

- **R2, Manage API tokens, Create Account API token**, with **Object Read & Write**, only for this bucket, TTL **Forever** and **no** client IP filter (GitHub's runners have no fixed address). Keep the Access Key ID and the Secret Access Key in the password manager; the secret is shown once.
- **The account id** may not be on that screen. It is the 32 characters after `dash.cloudflare.com/` in the address bar.
- **Bucket, Settings, Object lifecycle rules:** add a rule with no prefix that **deletes uploaded objects after 30 days**.

### 4. Check the role cannot write

The check runs a `DELETE` on production, so it is always inside a transaction that is rolled back: if the address is wrong, nothing is lost. `Read-Host` keeps the address out of the PowerShell history. Do not add quotes inside the `sh -c` text: Windows PowerShell removes them and the command breaks.

```powershell
$env:DATABASE_URL = Read-Host "Address"
"select current_user; begin; delete from users; rollback;" | docker run -i --rm -e DATABASE_URL postgres:18 sh -c 'psql $DATABASE_URL'
Remove-Item Env:DATABASE_URL
```

The expected answer is `backup_reader` and then `permission denied for table users`. If it shows another user (for example `neondb_owner`) or `DELETE` and a number, stop: the rollback kept the data, but that address can write, so it must not go in GitHub. Fix the note of step 2 and try again.

### 5. The secrets in GitHub

The copies run in GitHub Actions, so these go **only in GitHub**, not in the variables of the Worker in Cloudflare.

GitHub, the repository, **Settings, Secrets and variables, Actions, Repository secrets, New repository secret**. Six of them, with these exact names:

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
2. Do the restore test below **once** with that real copy.

**Last tried on 2026-11-05 against production** (SAG-135): the run made by hand finished green and put the file in R2; `backup_reader` was refused a delete; the copy restored locally with the same number of users as production and all 29 tables; and the private key and passphrase from the password manager opened it. The first scheduled run had not happened yet when this was written.

## Restore from a copy

Always restore into a **new, empty** database first, never over production.

**Test it on this computer (needs `npm run db:up`):**

1. Download the file from the R2 bucket (dashboard, the bucket, the file, Download) to an empty folder.
2. Decrypt it (asks for the passphrase):

   ```powershell
   $gpg = "C:\Program Files\Git\usr\bin\gpg.exe"
   & $gpg --output restored.dump --decrypt sagashelf-<date>.dump.gpg
   ```

3. Load it into a new local database and look inside:

   ```powershell
   docker exec sagashelf-db-1 psql -U sagashelf -d postgres -c "create database restore_check"
   docker cp restored.dump sagashelf-db-1:/tmp/restored.dump
   docker exec sagashelf-db-1 pg_restore -U sagashelf -d restore_check --no-owner /tmp/restored.dump
   docker exec sagashelf-db-1 psql -U sagashelf -d restore_check -c "select count(*) from users"
   docker exec sagashelf-db-1 psql -U sagashelf -d restore_check -c "select count(*) from information_schema.tables where table_schema = 'public'"
   ```

   The first count must match what production had that day, and the second the number of tables in `server/db/schema`.

4. **Delete everything**, because it is real personal data on your computer:

   ```powershell
   docker exec sagashelf-db-1 psql -U sagashelf -d postgres -c "drop database restore_check"
   docker exec sagashelf-db-1 rm /tmp/restored.dump
   Remove-Item restored.dump, sagashelf-<date>.dump.gpg
   ```

**Check the key in the password manager (when you make a new key, or on a new computer).** The key installed on this computer is not the one you would have if you lost it. This opens a copy with the saved key, in a throwaway key folder. `--homedir` needs a path in this form; a Windows path fails:

```powershell
$gpg = "C:\Program Files\Git\usr\bin\gpg.exe"
$testHome = "/c/Users/<you>/.gnupg-test"
New-Item -ItemType Directory "$HOME\.gnupg-test"
New-Item -ItemType File "$HOME\.gnupg-test\common.conf"
notepad key.asc   # paste the private key from the password manager, save, close
& $gpg --homedir $testHome --import key.asc
& $gpg --homedir $testHome --output check.dump --decrypt sagashelf-<date>.dump.gpg
(Get-Item check.dump).Length   # a number above zero, and no "No secret key" or "Bad passphrase"
& "C:\Program Files\Git\usr\bin\gpgconf.exe" --homedir $testHome --kill all
Remove-Item -Recurse -Force key.asc, check.dump, sagashelf-<date>.dump.gpg, "$HOME\.gnupg-test"
```

**To bring data back into production:** make a new database or branch in Neon, load the copy there with `pg_restore` (direct address, in your terminal), compare, and then copy back only what is missing or swap the address. Ask for help before doing this; it depends on what was lost.

## Looking after it

- A failed run emails you. A run that never happens does not: look at **Actions, Database backup** once a month, and at the bucket for a file from this week.
- In a public repository GitHub turns off scheduled workflows after 60 days without repository activity ([GitHub docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), read 2026-11-05). The project is active, but if it is ever left alone, turn the workflow on again in the Actions tab.
- R2 has a saved card behind it, so going over the free tier could be charged. Thirty copies of about 200 KB are far below 10 GB; look at the use of the bucket now and then.
- If the private key or the passphrase might have leaked: make a new key pair (step 1), replace `BACKUP_GPG_PUBLIC_KEY`, and delete the old copies from the bucket.
- If `BACKUP_DATABASE_URL` might have leaked: reset the password of `backup_reader` in Neon and replace the secret.
