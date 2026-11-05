# Incident plan

What to do when something goes wrong with SagaShelf, written for one person who may be reading it in a hurry. It is part 4 of SAG-29. The list of secrets and how to rotate each one is in [secrets](secrets.md); the reasons for the security choices are in [ADR-006](adr/006-security-model.md) and the [security review](reviews/2026-11-security-review.md).

Never paste a secret, a connection string or the address of a Discord webhook into a chat, an issue or a commit, not even while fixing an incident.

## The order that works for any incident

1. **Stop the damage first**, with the smallest lever in the table below. Do not look for the cause yet.
2. **Keep what shows what happened**: a screenshot, the time, the name of the log line. Do not delete anything.
3. **Rotate** what may have been exposed ([secrets](secrets.md)).
4. **Look for misuse**: the users in Clerk, the Workers logs, the last rows in Neon.
5. **Write it down** in a ticket: what happened, when, what was done, what stays open.

## The levers, from the smallest to the largest

| I want to...                            | Do this                                                                                                                                                                                                | Side effects                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pause the Discord webhooks**          | In the Worker's variables, set `WEBHOOKS_ENABLED` to `false`.                                                                                                                                          | The settings page says the feature is not available, nothing is saved or sent, and the hourly job does not even open the database. The endpoints and their queue stay as they are.                     |
| **Turn one provider off**               | Set `OPEN_LIBRARY_ENABLED`, `MANGADEX_ENABLED`, `WIKIDATA_ENABLED` or `TVMAZE_ENABLED` to `false`. For TMDB, remove `TMDB_READ_ACCESS_TOKEN` (a secret, not a switch).                                 | Titles already saved still show. The search answers from the database for that provider.                                                                                                               |
| **Close sign-ups**                      | In Clerk, **Access mode**: change **Open** to **Invite-only** (Clerk's own words, read 2026-11-04). Turning the allowlist on with no exceptions also blocks every sign-up, but only in Open mode.      | People who already have an account keep signing in. A new person sees a message that they need an invitation. **Blocking `/sign-up` in Cloudflare is not enough:** Clerk's API is on Clerk's own host. |
| **Slow an attack on the site**          | In Cloudflare, lower the numbers of the `API Burst` rule, or turn on the "under attack" mode in Security settings (the menu name changes).                                                             | A challenge can also stop Clerk's webhook deliveries ([edge-setup](edge-setup.md), section 9). Turn it off when the attack ends.                                                                       |
| **Stop one person**                     | In Clerk, ban the user, or delete them. Deleting fires `user.deleted`, and the webhook erases their data here.                                                                                         | There is no moderation tool yet (SAG-22). Deleting is permanent for them.                                                                                                                              |
| **Undo a bad deployment**               | Cloudflare, the Worker, **Deployments**: the three dots of the previous version, **Rollback**. Or in your terminal `npx.cmd wrangler rollback`. Or revert the pull request: a merge to `main` deploys. | A rollback only changes the code. It does not undo a migration (they are additive and applied by hand, ADR-002, so older code normally runs on the newer schema; this is not guaranteed).              |
| **Take the whole site off for a while** | In Cloudflare, Security, a custom rule that blocks every request (the Free plan has 5 custom rules and none is used). Delete the rule to bring the site back.                                          | Everything answers with Cloudflare's block page, including Clerk's webhook. It is reversible in a minute, which removing the domain is not.                                                            |
| **Recover data**                        | See "Neon: restore", below.                                                                                                                                                                            | Neon's history covers **6 hours** (Free plan). Older than that: the daily encrypted copy, up to 24 hours old ([backups](backups.md)).                                                                  |

How each variable is changed: Cloudflare dashboard, the Worker `sagashelf`, Settings, Variables and Secrets. `keep_vars` is on, so a deployment does not erase a variable set there. After changing one, open the page it affects and check that it changed.

## Scenarios

### A. A secret leaked (chat, commit, screenshot, log)

1. Do not delete the message or the commit first: note where and when it appeared.
2. Rotate that secret now, following [secrets](secrets.md). A leaked value is rotated even if nobody seems to have used it.
3. If it was in a commit of this repository, rotating is what protects you; rewriting history does not (a clone may already exist) and needs the owner's decision.
4. Look for misuse of that service: Clerk's user list and sessions, the Workers logs, Neon's recent queries, TMDB's usage page.
5. If it was a Discord webhook address of a person: tell them to delete that webhook in Discord and make a new one. The app turns the endpoint off by itself when Discord answers 401 or 404.
6. Write it down.

### B. The administrator's account may be taken over

1. In Google, change the password and sign out everywhere; in Clerk, revoke the sessions of that user.
2. In Neon, check `users.role`: only your account should be `admin`.
3. Look at what the administration can change: the sagas (`/admin/sagas`). Compare them with the last known good state; a Neon branch made from a point in the last 6 hours shows it.
4. Rotate `CLERK_SECRET_KEY` if the Clerk dashboard itself may have been reached.

### C. A wave of fake sign-ups or bot traffic

1. Close sign-ups in Clerk (table above).
2. Lower the `API Burst` rule or use the "under attack" mode, and watch that Clerk's deliveries still reach `200`.
3. In Clerk, block the email domains that are used. Disposable emails and subaddresses are already blocked in the Development instance (check Production, item M-3 of the review).
4. Delete the fake users in Clerk; the webhook erases their rows here.
5. Open sign-ups again when it stops.

### D. A bad deployment or a broken site

1. Roll back (table above). Do not fix forward while people see errors.
2. Open `https://sagashelf.app/api/health`: it must answer `{"status":"ok"}`.
3. Look at the Workers log for `job.failed` and for errors at the time of the deployment.
4. Make a ticket with the pull request that caused it.

### E. Data was deleted or corrupted

The Neon history is **6 hours** on the Free plan, so the first minutes matter: act before deciding why. If more than 6 hours passed, go to the daily copy in [backups](backups.md) (kept 30 days, up to 24 hours old).

1. Note the time of the last good state.
2. Pause what writes if it keeps damaging: webhooks off (table above), sign-ups closed. If the cause is a deployment, roll back first.
3. Neon: restore, below.
4. After a restore, people who signed up **after** the restore point exist in Clerk and not in the database. In Clerk, Webhooks, the delivery log, send again the `user.created` events from that time. They are not processed twice: the table of processed events was restored too.
5. Write it down, with the real size of the loss.

## Neon: restore

Neon's own words, read 2026-11-04: on the Free plan the history window is up to 6 hours (up to 1 GB of change history per project), the plan includes 1 manual snapshot, and a restore applies to a root branch. Sources: [History window](https://neon.com/docs/postgres/backup-restore/history-window) and [Neon plans](https://neon.com/docs/introduction/plans).

**To try it without touching production (item M-1, once, in your browser):**

1. In the Neon console, open the project, then Branches.
2. Create a branch from the production branch, choosing a **past point in time** (for example one hour ago). If the console offers other names for this, look for "past data" or "point in time".
3. Open the SQL Editor on the **new** branch and run `SELECT count(*) FROM users;`
4. Run the same on production. The two numbers should be close; the new branch may be a little smaller.
5. **Delete the test branch.** A branch that stays awake uses the compute hours of the plan (100 a month, ADR-012).
6. Tell me the two numbers and how long it took. Do not paste any row, and never an email.

**In a real incident,** use the restore of the production branch to a time inside the window, and read what the screen says it keeps before confirming.

## The scripted burst (item M-2)

A small burst against production, to see that the limits answer 429. It changes no data: the only effect is a language cookie in an answer that PowerShell throws away. Run it in **your own PowerShell**, from any folder. Do not run it twice in a minute.

**1. The rule of the WAF on `/api/*`** (30 requests in 10 seconds per IP). It sends 45 quick requests to the health check and counts the answers. Expected: some `200` and then some `429`. A few seconds later it works again.

```powershell
$codes = @{}
1..45 | ForEach-Object {
  try {
    $code = [int](Invoke-WebRequest -Uri "https://sagashelf.app/api/health" -UseBasicParsing).StatusCode
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  }
  $codes[$code] = 1 + [int]$codes[$code]
}
$codes.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name): $($_.Value)" }
```

**2. The limit of the Worker for writes** (30 a minute per caller and location). It sends 70 requests to the language route, paced so that the WAF rule is not reached, and counts the answers. Expected: about 60 `303` at most and the rest `429`; if the burst falls in two clock minutes, up to 30 can pass in each. Wait one minute before the next run.

```powershell
$codes = @{}
1..70 | ForEach-Object {
  try {
    $r = Invoke-WebRequest -Uri "https://sagashelf.app/api/locale" -Method Post `
      -Headers @{ Origin = "https://sagashelf.app" } `
      -Body @{ locale = "es"; redirectTo = "/" } -MaximumRedirection 0 -UseBasicParsing
    $code = [int]$r.StatusCode
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  }
  $codes[$code] = 1 + [int]$codes[$code]
  Start-Sleep -Milliseconds 400
}
$codes.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name): $($_.Value)" }
```

Say what each run printed. If a run prints no `429`, do not repeat it: tell me, because a limit that does not answer is a finding.

**Turnstile:** the one that users meet is inside Clerk's sign-up and cannot be tried from outside (it appears when Clerk finds the sign-up suspicious). It is checked in the Clerk dashboard (item M-3 of the review), not with a burst.

## Facts from other companies, with the date they were read

- **Neon, Free plan:** history window of up to 6 hours, up to 1 GB of change history per project, 1 manual snapshot, a restore applies to root branches (neon.com/docs, 2026-11-04). The paid plans keep more history; the cost is not written here.
- **Clerk, Access mode:** Open, Invite-only and Waitlist (API names public, restricted and waitlist); the allowlist only works in Open mode, and turning it on with no exceptions blocks all sign-ups; a restricted instance answers 403 `sign_up_mode_restricted` (clerk.com/docs, "Restricting access", 2026-11-04). The exact click path was not shown by the page; look for **Access mode**.
- **Cloudflare Workers, rollback:** from the dashboard (Deployments, the three dots of a version, Rollback) or `wrangler rollback [VERSION_ID]`; only the 100 most recent versions can be targets; it needs the Editor role on the Worker; it changes code and not connected resources (developers.cloudflare.com, "Rollbacks", 2026-11-04).

## What this plan does not decide

- **Telling the people affected.** The privacy policy says nothing about what is done after a leak (a search of the Spanish text for "brecha", "incidente", "vulneración" and "filtración" found nothing). Whether to promise something, and what the law asks for people in other countries, is the owner's decision with advice; the legal pages were not touched here.
- **A second person with access.** Today only the owner can do any of this. A trusted person with a copy of this page and access to the accounts would be the first thing to add if the site grows.
