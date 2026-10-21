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
