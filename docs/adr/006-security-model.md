# ADR-006: Security model

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Built, with one part missing: moderation (SAG-22). A restore of the daily copy was tried on 2026-11-05 (SAG-135). Reviewed against the code on 2026-11-04 (SAG-29, part 1): see [the security review](../reviews/2026-11-security-review.md), which also lists the gaps found.
- **Tickets:** SAG-5, SAG-7, SAG-10, SAG-11, SAG-17, SAG-22, SAG-27, SAG-29

## Context

SagaShelf is a public website with accounts, user-generated content, a social graph, outgoing webhooks and calls to third-party APIs, built by one person and deployed continuously. It holds personal data (email addresses, a viewing history, social connections), and its repository is public. The threats that matter most are automated abuse, account takeover, and mistakes that leak secrets or let one user reach another's data.

## Decision

Security is layered: the repository and pipeline stop mistakes before they ship, the application checks every input and every permission on the server, and the edge slows down abuse before it reaches the Worker. The table lists each threat, the controls, where they live, and whether they exist today.

| Threat                                             | Controls                                                                                                                                                                                                                                                                    | Where                                                                               | Today                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Leaked secrets**                                 | `.env*` and `.dev.vars*` ignored, `.env.example` has names only, secrets are Workers secrets, the `env` module reports a variable name and never its value, gitleaks on every PR                                                                                            | Repo, `server/env.ts`, CI (SAG-3, SAG-5)                                            | Built                                                |
| **Vulnerable or malicious dependencies**           | Lockfile with `npm ci`, dependency review on PRs, `npm audit`, Dependabot, CodeQL, GitHub Actions pinned to commit hashes                                                                                                                                                   | CI (SAG-5)                                                                          | Built                                                |
| **Unreviewed changes to `main`**                   | A ruleset: pull request required, required checks, squash only, linear history, no force push, no deletion, no bypass                                                                                                                                                       | GitHub (SAG-5)                                                                      | Built                                                |
| **Bad input**                                      | Zod validation at every boundary (environment and the language form today); typed code with `strict`; parameterized queries through Drizzle                                                                                                                                 | `server/`, routes (SAG-3, SAG-8, SAG-9)                                             | Built                                                |
| **Cross-site request forgery**                     | `SameSite=Lax` cookies and an `Origin` check, with the size, in every state-changing resource route: `checkWrite` (SAG-128), kept by `app/architecture.test.ts` and proven by `app/routes/write-actions.test.ts`                                                            | Routes (SAG-8, SAG-10)                                                              | Built                                                |
| **Cross-site scripting**                           | React escapes rendered values; no raw HTML from users; a CSP with a per-page nonce, no inline or eval code and no other origin, plus the other security headers on every response                                                                                           | Framework, Worker, `server/security-headers.ts` (SAG-7), review (SAG-29)            | Built                                                |
| **Account takeover and credential stuffing**       | Clerk holds credentials, verification is required, breached-password check, lockout, MFA required for admins, canonical email, generic errors, rate limits on auth routes                                                                                                   | Clerk, routes (SAG-10, SAG-7)                                                       | Built (Clerk)                                        |
| **Bots, scraping and abuse (including AI-driven)** | `robots.txt` for crawlers and AI bots, Cloudflare AI bot policy and Bot Fight Mode, a Workers rate limit on write endpoints, one WAF rate rule, query length limits, Clerk's Turnstile on sign-up (no form of ours has one, SAG-132), bot filtering in analytics            | Worker (SAG-7), dashboard ([edge setup](../edge-setup.md)), routes (SAG-15, SAG-24) | Built                                                |
| **Broken access control (IDOR)**                   | Authorization on the server for every route, never trusting ids from the client, privacy filters in queries, a test per route for anonymous, user, other user, friend and admin                                                                                             | Routes, tests (SAG-10, SAG-21, SAG-29)                                              | Built                                                |
| **Server-side request forgery**                    | Outgoing webhooks accept only `https://discord.com/api/webhooks/...` (and `discordapp.com`), no redirects; the image proxy only fetches allowed provider hosts; provider calls go to fixed hosts                                                                            | `server/` (SAG-17, SAG-27)                                                          | Built                                                |
| **Injection and mass assignment**                  | Parameterized queries, schemas that pick only allowed fields                                                                                                                                                                                                                | `server/` (SAG-9)                                                                   | Built                                                |
| **Webhook forgery and replay (incoming)**          | Svix signature verification, timestamp checks, idempotency by event id                                                                                                                                                                                                      | Route `webhooks.*` (SAG-11)                                                         | Built                                                |
| **Webhook abuse (outgoing)**                       | Discord webhooks only (ADR-029): an allow list of addresses, the address masked wherever it leaves the server, no redirect followed, retries with backoff, an endpoint turned off after repeated failures, a delivery log without secrets                                   | Cron and outbox (SAG-27)                                                            | Built                                                |
| **Spam and harassment**                            | Reports, moderation states, bans, rate limits, community rules                                                                                                                                                                                                              | Routes, admin (SAG-22, SAG-26)                                                      | Partial (blocks and mutes built; reports are SAG-22) |
| **Cost abuse of providers**                        | Per-provider rate limiter and circuit breaker, caching, local-first search                                                                                                                                                                                                  | `server/` (SAG-13, SAG-15)                                                          | Built                                                |
| **Personal data in logs**                          | No tokens, emails or personal data in logs; generic error responses; visitor hashes with a rotating salt instead of IPs in analytics                                                                                                                                        | Everywhere (SAG-10, SAG-24, SAG-29)                                                 | Built                                                |
| **Data loss**                                      | Neon point-in-time restore, tested on a branch before launch (window of 6 hours on the Free plan, Neon docs, read 2026-11-04); a Neon snapshot before a risky migration; a daily encrypted copy kept 30 days outside Neon ([ADR-036](036-daily-encrypted-database-copy.md)) | Neon (SAG-29)                                                                       | Built (SAG-135)                                      |

### Rules that apply to every change

- A new state-changing route validates its input with Zod, checks the `Origin`, and checks permissions on the server.
- Anything that fetches a URL supplied by a user or a provider uses an allow list and never follows redirects blindly.
- Secrets are referred to by name only, in code, tests, logs, commits and chat.
- `server/` code never reaches the browser bundle.

### Incident plan

Before launch (SAG-29) there must be a written procedure to rotate each key, disable sign-ups, and pause outgoing webhooks, and an inventory of secrets by name only. The inventory and how to rotate each secret are in [`../secrets.md`](../secrets.md) (SAG-29, part 3); the procedure for an incident is [`../incident-plan.md`](../incident-plan.md) (part 4).

## Alternatives considered

- **Rely on the platform alone.** Cloudflare and Clerk remove large classes of risk, but they do not check our authorization logic or our dependencies. Rejected as the only layer.
- **Postpone security work until launch.** The cheapest moment to enforce secret scanning, pinned actions and branch rules is before there is code to rewrite. Rejected: the controls marked "Built" were put in place first on purpose.

## Consequences

**Good**

- Repository and pipeline controls are enforced by machines, not by memory.
- The table is a checklist for the pre-launch review (SAG-29, OWASP ASVS level 2).

**Costs and risks**

- The WAF rule, Bot Fight Mode, the AI bot policy, DNSSEC and the custom domain live in the Cloudflare dashboard and not in the repository (steps and dates in [`../edge-setup.md`](../edge-setup.md)). Preview URLs are publicly reachable.
- The `Origin` check and the size limit are one helper, `checkWrite` (SAG-128), and a test fails for a write route that does not call it. The one `GET` that wrote, `/media/open`, is outside that check, so it needs a session and has a limit per person ([ADR-035](035-saving-a-title-needs-a-session.md), SAG-130).

## Open questions

- The Workers Rate Limiting binding works on the Free plan but is approximate ([ADR-011](011-edge-security-and-domain.md)); the WAF rate rule is the second layer.
- Whether preview deployments should sit behind Cloudflare Access.

## References

- OWASP Application Security Verification Standard, <https://owasp.org/www-project-application-security-verification-standard/>
- [Security review, November 2026](../reviews/2026-11-security-review.md) (SAG-29): the table above against the code, the ASVS level 2 walk and the findings
- Tickets listed above (Linear)
