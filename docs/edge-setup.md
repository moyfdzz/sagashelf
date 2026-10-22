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

| Name                    | Kind                  | Where                                                             |
| ----------------------- | --------------------- | ----------------------------------------------------------------- |
| `CLERK_SECRET_KEY`      | Secret                | Previews Base now; Production when the production instance exists |
| `CLERK_PUBLISHABLE_KEY` | Public variable       | Same tabs                                                         |
| `CLERK_JWT_KEY`         | Public variable (PEM) | Same tabs                                                         |

- [ ] Add the three values to **Previews Base** with the development instance keys, so previews can sign in. Previews do not inherit the production values.
- [ ] Without these values a deployment still serves the public pages, and protected routes and the sign-in pages answer 503.

### Production instance (when the site goes live)

- [ ] In Clerk, create the Production instance from the Development one and choose the domain `sagashelf.app`.
- [ ] In Cloudflare, DNS, add the CNAME records Clerk lists (the Frontend API, the account portal, and the email records). Set every one of them to **DNS only** (grey cloud, not proxied), as Clerk requires, so Cloudflare does not sit in front of its verification. Wait until Clerk shows the domain as verified and has issued its certificates.
- [ ] Create our own Google OAuth credentials in Google Cloud (a consent screen and an OAuth client of type web), put the redirect URI that Clerk shows in them, and paste the client id and secret into Clerk's Google connection. The shared development credentials Clerk uses in the Development instance do not work in production.
- [ ] Put the production publishable key, secret key and JWT public key in the **Production** variables. The JWT public key is read from the production instance, which has its own.
- [ ] The Clerk instance, its webhook endpoint (SAG-11) and Svix signing secret are separate for each instance.
- [ ] Check in a browser: sign up with a new address, receive the code, sign in with Google, sign out, and confirm that the home page still has the strict policy (<https://securityheaders.com> and the Observatory should keep their grades, because only `/sign-in` and `/sign-up` use the wider policy).
- [ ] Set the first administrator by hand in the database after their mirror row exists (SAG-11): the account must be the one with the Google login and 2-step verification.
