# Cloudflare dashboard setup (owner steps)

Some edge settings live in the Cloudflare dashboard and not in this repository. This page lists them in order, with what to check afterwards. The reasons are in [ADR-011](adr/011-edge-security-and-domain.md). Menu names can change; if one differs, look for the same setting by its name.

Never paste a key or a secret into the repository, an issue or a chat. Secrets go in the dashboard under the Worker's variables and secrets, or with `wrangler secret put`.

## 1. Custom domain

The domain is declared in `wrangler.jsonc` (`routes` with `custom_domain: true` for `sagashelf.app` and `www.sagashelf.app`). After the change is merged and deployed, Cloudflare creates the DNS records and certificates by itself.

- [x] **Before merging the domain change:** in the zone `sagashelf.app`, DNS, Records, check that there is no existing record for `sagashelf.app` or `www` (for example a parking page). Cloudflare cannot create a custom domain on a hostname that already has a CNAME record. Remove only records you do not use.
- [x] In the dashboard, open the zone `sagashelf.app` and confirm that the records for `sagashelf.app` and `www` exist and are proxied.
- [x] Open <https://sagashelf.app> and <https://www.sagashelf.app>. The second must redirect to the first.
- [x] Open <https://sagashelf.app/api/health>. It must answer `{"status":"ok"}`.

## 2. SSL/TLS and DNSSEC

- [x] SSL/TLS, Overview: set the encryption mode to **Full (strict)**. Done by the owner on 2026-10-21.
- [x] SSL/TLS, Edge Certificates: turn **Always Use HTTPS** on. Done and checked on 2026-10-21: `http://sagashelf.app` now answers 301 to HTTPS. Without it a plain `http://` request is answered with the page. Browsers already upgrade `.app` addresses by themselves, but other clients do not.
- [x] DNS, Settings: turn **DNSSEC** on. Checked on 2026-10-21: the DS record is published at `.app` and the chain validates. The domain is registered at Cloudflare, so the signing record is added automatically. Confirm that the status becomes active.

## 3. Bot Fight Mode and AI bots

- [x] Security Settings, filter by "Bot traffic": turn **Bot fight mode** on. Done by the owner on 2026-10-21.
- [x] Security Settings, **Configure AI bot policies**: **Training** is Block, **Agent** is Block, and **Search** is Allow, so the search engines you want to appear in are not blocked. Done by the owner on 2026-10-21 (not visible from outside, because Cloudflare decides verified bots by IP, not by user agent).

## 4. WAF rules (Free plan)

The Free plan allows 5 custom rules and **1 rate-limiting rule** with a 10 second window, the IP as the counting key, and only the path and the verified-bot flag as fields.

- [x] Security, Security rules, Rate limiting rules: the rule `API Burst` matches `(http.request.uri.path wildcard "/api/*") and not cf.client.bot`, 30 requests per 10 seconds per IP, action Block for 10 seconds. Checked on 2026-10-21: of 120 parallel requests to `/api/health`, 31 got `200` and 89 got `429`; the block lifted after 12 seconds; 120 requests to `/` all got `200`. Verified bots are excluded because rate limiting them can hurt search visibility.
- [ ] Custom rules: add rules only if abuse appears. Do not block countries or networks without evidence.

## 5. Turnstile

The widget is wired into forms in SAG-10, but the keys can be created now.

- [x] Turnstile, widget `SagaShelf` in Managed mode for the hostname `sagashelf.app`. `www` is not needed: the Worker redirects it to the apex domain, so the widget only ever loads there. More hostnames can be added later in the widget settings (the Free plan allows 10 per widget).
- [x] The secret key is stored only as the Worker secret `TURNSTILE_SECRET_KEY`, in the **Production** variables (checked on 2026-10-21: the secret is listed as an encrypted value). The **site key** is public and goes into the page in SAG-10.
- [ ] Previews have their own set of variables (the **Previews Base** tab). They do not receive the production secret. SAG-10 decides how to test Turnstile on previews, for example with a separate widget and its own secret.

## 6. Check the result

- [x] Mozilla Observatory: **A+** on 2026-10-21 (score 145, 12 of 12 tests passed).
- [x] securityheaders.com: **A+** on 2026-10-21. Its only suggestion was `Cross-Origin-Embedder-Policy`, which is deliberately not set because it breaks embedding third-party widgets such as Turnstile and Clerk.
- [x] A burst of requests gets `429`: from the Worker on `/api/locale` and from the WAF rule on `/api/*` (see above and the burst test in `e2e/security.spec.ts`).

## 7. Email (optional)

The contact address uses Cloudflare Email Routing (the zone has its MX, SPF and DKIM records). The dashboard recommends adding a **DMARC** record so mail providers can reject messages that fake an `@sagashelf.app` sender.

- [x] DMARC Management is enabled. Checked on 2026-10-21: `_dmarc` is `v=DMARC1; p=none; rua=mailto:...@dmarc-reports.cloudflare.net` (monitoring mode, reports go to Cloudflare), next to the existing SPF and DKIM records. Move to a stricter policy only after the reports show that all legitimate mail passes.

## 8. Clerk accounts (SAG-10)

The reasons are in [ADR-003](adr/003-auth-clerk.md). Clerk has two instances: **Development** (used locally and on previews) and **Production** (created when the site goes live). Never paste a key into the repository, an issue or a chat.

### Development instance (done for local work)

- [x] Application `SagaShelf` in the Clerk organization on the Hobby plan.
- [x] Email is required at sign-up with a verification code. Username is required (3 to 30 characters, no extended characters, no numeric-only names). Password is on, with **Reject compromised passwords**. Google is on in SSO connections.
- [x] Protections: **Block email subaddresses**, **Block sign-ups that use disposable email addresses** and **Challenge suspicious sign-ups** are enabled. The bot challenge is under Configure, Protect, Protections.
- [x] **Enable API keys** (the dialog that lets users generate keys for your own API) is **not** needed and stays off.
- [x] Keys: the publishable key and the secret key come from the **API keys** page. The secret key is shown in full only when it is created, so copy it at that moment. The dashboard of this instance showed **JWKS Public Key** (a JSON file at `/.well-known/jwks.json`) and no PEM button, so the PEM was derived from the JWK (an RSA public key, `jwk` to `spki` in Node's `crypto`).
- [x] Local values go in `.dev.vars` (names in `.env.example`): `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `CLERK_JWT_KEY`. The PEM goes on one line with `\n` between its lines, and the code turns those back into line breaks.

### Worker variables and secrets

| Name                    | Kind                  | Where                                                           |
| ----------------------- | --------------------- | --------------------------------------------------------------- |
| `CLERK_SECRET_KEY`      | Secret                | Previews Base (development key) and Production (production key) |
| `CLERK_PUBLISHABLE_KEY` | Public variable       | `wrangler.jsonc` (`previews.vars` and `vars` for production)    |
| `CLERK_JWT_KEY`         | Public variable (PEM) | `wrangler.jsonc` (`previews.vars` and `vars` for production)    |

- [x] The secret key is in **Previews Base** (set by the owner on 2026-10-21). The two public values live in `wrangler.jsonc`, not in the dashboard: a variable added by hand in the dashboard makes Cloudflare report that the dashboard and the file are out of sync, and a deployment can overwrite it. The JWT public key is written there as a normal JSON string with `\n` line breaks. A copy pasted into the dashboard keeps its quotes, and the code removes them anyway.
- [x] gitleaks flags a publishable key as a generic API key, although it is public by design. `.gitleaks.toml` keeps the default rules and allows only the exact value of the development publishable key. When the production instance exists, add its `pk_live_` value to that list in the same way; never allow a whole rule or file. The action runs gitleaks 8.24.3, which reads the singular `[allowlist]` table (`[[allowlists]]` needs 8.25 and is ignored silently by 8.24.3, which is why the first attempt still failed). Checked on 2026-10-22 with the gitleaks Docker images 8.24.3 and latest, on the same commit range as the CI: the finding appears with the default rules and disappears with the exception, and a different `pk_test_` value is still reported.
- [ ] Delete the dashboard copies of `CLERK_PUBLISHABLE_KEY` and `CLERK_JWT_KEY` in Previews Base once the file is deployed, so there is one source of truth. Leave the secret key.
- [ ] Without these values a deployment still serves the public pages, and protected routes and the sign-in pages answer 503.

### Production instance (when the site goes live)

- [x] In Clerk, create the Production instance from the Development one and choose the domain `sagashelf.app`. Done on 2026-10-23, and the domain shows as Verified.
- [x] In Cloudflare, DNS, added the CNAME records Clerk lists, all set to **DNS only** (grey cloud). Done on 2026-10-23.
- [x] Our own Google OAuth credentials were created in Google Cloud (a consent screen and an OAuth client of type web), with the redirect URI Clerk shows, and pasted into Clerk's Google connection with the default scopes only. The app was published on 2026-10-23, after SAG-34 added `/privacy` and `/terms`: Google keeps the Publish app button disabled without a privacy policy URL. No logo was uploaded, because Google asks for verification once there is one.
- [x] The production publishable key and JWT public key are in `vars` of `wrangler.jsonc`, and the secret key is a Workers secret in Production (`wrangler secret put`, 2026-10-23). Before this, `/sign-in` answered 503 on `sagashelf.app`, which is the designed answer without keys.
- [x] The Clerk instance, its webhook endpoint (section 9) and its Svix signing secret are separate for each instance.
- [x] Checked in a browser by the owner on 2026-10-23: sign-up and sign-in with Google with an account outside the test users after publishing, and the new user appeared in the production database. The grades of securityheaders.com and the Observatory were not run again after this change.
- [ ] Set the first administrator by hand in the database after their mirror row exists (SAG-11): the account must be the one with the Google login and 2-step verification. **Open:** it has not been done, and no administrator exists in production; the admin guard needs a verified Google login. Whether Google stays the way to protect the administrator is undecided (see the notes of SAG-12).

## 9. Clerk webhook (SAG-11)

The endpoint is `POST /webhooks/clerk`. How it works is in [ADR-003](adr/003-auth-clerk.md#the-webhook). Each Clerk instance has its own endpoint and its own signing secret.

### Before the first deploy that uses it

- [x] Migration `0004_users_clerk_updated_at` was applied to the production database by the owner on 2026-10-23 (the preview database was not checked here).

### Create the endpoint (development instance first)

- [ ] In Clerk, Configure, Webhooks, Add endpoint. The URL must be public. For a pull request preview use its URL, `https://<preview>.workers.dev/webhooks/clerk`; for production, `https://sagashelf.app/webhooks/clerk`. A local server is not reachable by Clerk.
- [ ] Subscribe to **only** `user.created`, `user.updated` and `user.deleted`. Other events are answered 200 and ignored, but there is no reason to send them.
- [ ] Copy the **Signing Secret** (starts with `whsec_`) from the endpoint page. Store it only as the Worker secret `CLERK_WEBHOOK_SIGNING_SECRET`: in **Previews Base** for the development instance, and in **Production** for the production instance. Never in the repository, an issue or a chat. In `.dev.vars` only for your own tests.
- [ ] Without the secret the endpoint answers 503, so a deployment that has not been set up never accepts an event.
- [ ] With the endpoint created, use Clerk's **Testing** tab to send an example event, and check the **delivery log**: the answer must be 200 with a body like `{"status":"applied"}` (or `"ignored"` for an event we do not use).
- [ ] **Bot Fight Mode** (section 3) may challenge Svix's requests, because on the Free plan it cannot be skipped with a WAF rule. If the delivery log shows 403 or a Cloudflare challenge page, tell the owner before changing anything: the options are a narrow WAF rule, or turning that setting off for this path where the plan allows it. Not checked yet.

### Production endpoint (done on 2026-10-23)

- [x] Endpoint `https://sagashelf.app/webhooks/clerk` in the **Production** Clerk instance, subscribed to `user.created`, `user.updated` and `user.deleted` only. Its signing secret is the Workers secret `CLERK_WEBHOOK_SIGNING_SECRET` in Production.
- [x] An unsigned request to the endpoint answered `401` (not `503`) once the secret was set.
- [x] A real sign-up with Google created the row in `users` of the production database: Clerk delivered `user.created`, the signature was verified and the account was mirrored. Clerk's Testing tab sends an example user with no email, which the endpoint refuses on purpose (`rejected`, status 200).
- [x] **Bot Fight Mode** did not stop Svix's delivery of a real event (the row exists), so no WAF exception was needed. This was seen once; check the delivery log again if deliveries start to fail.

### Test it locally, without real data

- **Automatic tests:** `npm run test` covers the route and the planning rules with fake events and a signing secret made for the tests. `npm run test:integration` (needs `npm run db:up`) runs the replay, ordering, deletion and refusal cases on a real Postgres.
- **A signed request against `npm run dev`:** put `CLERK_WEBHOOK_SIGNING_SECRET=whsec_` followed by any base64 text in `.dev.vars`, restart the dev server, and send an event signed with that same secret (the Standard Webhooks scheme: HMAC-SHA256, in base64, over `svix-id.svix-timestamp.body`, in the `svix-signature` header as `v1,<signature>`). Use the fake users of the tests, never a real person's data. An event of a type we do not use answers 200 `ignored` without a database; a user event needs `DATABASE_URL` to a database that the Neon HTTP driver can reach, so use a Neon preview branch, not the local Docker one.
- **Verified in the Worker runtime on 2026-10-22:** with a signing secret made for the check, a valid event answered 200, and a missing signature, a wrong secret, a changed body and a 10 minute old timestamp all answered 401.
- **Verified on a preview on 2026-10-22:** Clerk's Testing tab sent an example `user.created` to the preview of the `feat/SAG-12-account-settings` branch, and the delivery log showed `200` with `{"status":"rejected"}`. That is the expected answer: the example has no username and no email, so it is refused. It proves the signature check, the database connection of the preview and the write to `processed_webhooks` and the outbox. The `applied` path needs a real sign-up (the examples never have a username and a verified email).

### Things learned while setting up the preview endpoint (2026-10-22)

- **A secret added to Previews Base after a preview exists did not reach that preview.** The preview answered `503 not_configured` for several builds, even with a code change that forced a new version. Adding the same secret in the settings of the preview itself fixed it at once (`401` for an unsigned request, with no new build). The likely reason is that a preview takes a copy of Previews Base when it is created, but this was not found in Cloudflare's documentation. So: put a new secret in Previews Base **and**, for a branch that already has a preview, in that preview's own settings (or delete the branch's preview and push again).
- **Empty commits and comment-only changes do not make a new version.** A comment does not change the bundle, so it cannot be used to force a rebuild.
- **The preview URL of a branch is `https://<branch with dashes>-sagashelf.<account subdomain>.workers.dev`** and only exists while the branch does (it answers 404 after the branch is deleted). The endpoint URL in Clerk must be edited whenever the branch changes. Old per-version preview URLs of earlier pull requests answered Cloudflare error 1101, and the cause is unknown; a new preview worked.
- **Clerk's example events give the event time in seconds** (the user's own times are in milliseconds). The webhook reads both.
- The endpoint logs a warning that names `CLERK_WEBHOOK_SIGNING_SECRET` when the secret is missing, so a `503` can be traced in Observability.

## 10. TMDB (SAG-13)

- [x] Account on themoviedb.org (owner, 2026-10-25). The adapter uses the **API Read Access Token** (the long one that starts with `eyJ`), not the short v3 API key: it goes in an `Authorization` header, so it never appears in a URL, an error or a log.
- [ ] Local value in `.dev.vars`: `TMDB_READ_ACCESS_TOKEN` (name in `.env.example`).
- [ ] Workers secret `TMDB_READ_ACCESS_TOKEN`, with `wrangler secret put TMDB_READ_ACCESS_TOKEN` for Production, and in Previews Base. For a branch that already has a preview, also in that preview's own settings (see section 9). Without it no provider exists and the search answers from the database.
- [ ] The TMDB logo and notice on the credits page (SAG-31). Terms read 2026-10-25; non-commercial use only; data kept at most 6 months (ADR-016).
