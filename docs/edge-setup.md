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

- [ ] SSL/TLS, Overview: set the encryption mode to **Full (strict)**.
- [x] SSL/TLS, Edge Certificates: turn **Always Use HTTPS** on. Done and checked on 2026-10-21: `http://sagashelf.app` now answers 301 to HTTPS. Without it a plain `http://` request is answered with the page. Browsers already upgrade `.app` addresses by themselves, but other clients do not.
- [x] DNS, Settings: turn **DNSSEC** on. Checked on 2026-10-21: the DS record is published at `.app` and the chain validates. The domain is registered at Cloudflare, so the signing record is added automatically. Confirm that the status becomes active.

## 3. Bot Fight Mode and AI bots

- [ ] Security Settings, filter by "Bot traffic": turn **Bot fight mode** on.
- [ ] Security Settings, **Configure AI bot policies**: set **Training** to Block, **Agent** to Block, and **Search** to Allow. Check the description of the Search option and make sure it does not block the search engines you want to appear in.

## 4. WAF rules (Free plan)

The Free plan allows 5 custom rules and **1 rate-limiting rule** with a 10 second window, the IP as the counting key, and only the path and the verified-bot flag as fields.

- [ ] Security, WAF, Rate limiting rules: create one rule for requests whose path starts with `/api/`, for example 20 requests per 10 seconds per IP, action Block for 10 seconds. Do not apply it to verified bots, which can hurt search visibility.
- [ ] Custom rules: add rules only if abuse appears. Do not block countries or networks without evidence.

## 5. Turnstile

The widget is wired into forms in SAG-10, but the keys can be created now.

- [ ] Turnstile, add a widget for the hostnames `sagashelf.app` and `www.sagashelf.app` (the Free plan allows 10 hostnames per widget, so preview hostnames can be added later).
- [ ] Keep the **site key** (public) for the page. Store the **secret key** only as the Worker secret `TURNSTILE_SECRET_KEY`.

## 6. Check the result

- [x] Mozilla Observatory: **A+** on 2026-10-21 (score 145, 12 of 12 tests passed).
- [x] securityheaders.com: **A+** on 2026-10-21. Its only suggestion was `Cross-Origin-Embedder-Policy`, which is deliberately not set because it breaks embedding third-party widgets such as Turnstile and Clerk.
- [ ] Send a burst of requests to a write endpoint and confirm that `429` answers appear (see the burst test in `e2e/security.spec.ts`).

## 7. Email (optional)

The contact address uses Cloudflare Email Routing (the zone has its MX, SPF and DKIM records). The dashboard recommends adding a **DMARC** record so mail providers can reject messages that fake an `@sagashelf.app` sender.

- [ ] DNS, add the DMARC record the dashboard suggests. Start in monitoring mode (`p=none`) and only move to a stricter policy after reading the reports.
