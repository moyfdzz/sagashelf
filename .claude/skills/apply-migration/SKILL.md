---
name: apply-migration
description: Guide the owner through applying a Drizzle migration to the production database by hand, or any other command that reads or writes production (a manual SQL change, a backup or restore). Use when a PR adds a file under drizzle/ or the owner must change a row in production.
---

# Applying a migration in production

Migrations are **not** run by CI or by the deploy (ADR-002; SAG-267 plans a workflow with approval). The owner applies them from their own PowerShell. **You never see the connection string**: never ask for, accept or print it, the Clerk secret key, the TMDB token, a Discord webhook address or `.dev.vars` contents. The owner's `.dev.vars` points to a **remote** database: never run anything that writes through the app against it.

## Before

1. **Order with the deploy.** A hand-applied migration and the deploy never land together, so write the statement to work with the old schema and the new one (for example `ON CONFLICT DO NOTHING` with no target, ADR-043). An additive migration is safe **before** the merge and **must** go before it when the deployed code reads or writes the new column or table on a common path; **a column that every insert writes must be applied before the merge** (SAG-254: a deploy first would fail every event). One the code can live without goes after. Say the order in the PR and in `docs/edge-setup.md`.
2. Commit and open the PR first, then ask the owner to apply it.
3. **A migration that changes or deletes data** (not an added nullable column) is preceded by a Neon snapshot the owner takes by hand (`docs/backups.md`). If it adds a constraint to existing rows, ask first for a `SELECT count(*)` of the rows that would break it.
4. Ask whether the migration was applied before editing it: until then it can change (see `.claude/rules/database.md`); after, any change is a new migration.
5. If the new code reads the new table or column on the title page, the feed or any page every visitor opens, the PR summary starts with **Apply migration NNNN BEFORE merging** in bold, and the agent asks for it before saying the PR is ready (SAG-22, 2026-11-20: the title pages ran minutes without `reviews`).

## The command (one line, the owner asked for it on 2026-11-06)

Tell the owner: Neon console, Connect, **production branch**, **Connection pooling off** (direct connection), copy the string. Then give this as ONE line to paste in PowerShell from the repo root (a multi-line paste lets `Read-Host` swallow the next lines):

```powershell
git fetch origin; git checkout <branch>; git pull --ff-only; $s = Read-Host "DATABASE_URL" -AsSecureString; $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $s).Password; try { npm.cmd run db:migrate } finally { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; Remove-Variable s; "DATABASE_URL removed: $(-not (Test-Path Env:DATABASE_URL))" }
```

`npm.cmd`, because PowerShell blocks `npm.ps1`.

## After

Ask the owner to run, in the Neon SQL Editor with the production branch selected, `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '<table>'` and to paste only that result. Never ask for emails. Update the last applied migration in `CLAUDE.local.md`. The migrations applied in production are the ones in `drizzle/meta/_journal.json` up to that one.

## Other work on production data

- **When the owner must change or delete a row by hand, look it up first** (`SELECT` by a column you know, never emails) and use `... WHERE id = '<id>' RETURNING ...` so they see how many rows changed.
- **A command that writes to production, even a check, goes inside `begin; ...; rollback;`** (on SAG-135 the owner pasted the owner role's address by mistake and only the rollback kept the rows).
- Backups and restore are in `docs/backups.md`. Windows traps found there (SAG-135): `mkdir -m 700` fails in Git Bash (`mkdir` then `chmod 700 ... || true`); PowerShell 5.1 corrupts binary data piped to a native command (use `docker cp` or `cmd /c` for a `.dump`); the owner's PowerShell does not find `gpg` (use `& "C:/Program Files/Git/usr/bin/gpg.exe"`); a new `.gnupg` gets `use-keyboxd` in `common.conf` and Git's `gpg` fails to start `keyboxd` (empty that file); that `gpg` reads no Windows path in `--homedir` and needs a short one; `gpg-agent --daemon` holds an open pipe, so never pipe its output; `host.docker.internal` reaches the local Postgres from a container; pass a secret to `docker run` with `--env NAME` (no value); Windows PowerShell removes double quotes inside a single-quoted argument of a native command, so send SQL through a pipe with `docker run -i`.
