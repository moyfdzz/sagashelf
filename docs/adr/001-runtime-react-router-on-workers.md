# ADR-001: React Router v8 (framework mode, SSR) on Cloudflare Workers

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Done (SAG-3), refined in SAG-4, SAG-5 and SAG-8
- **Tickets:** SAG-3, SAG-5, SAG-8

## Context

SagaShelf is a personal, non-commercial portfolio app. It needs server-rendered public pages (search engine optimization and link previews), API routes and incoming webhooks in the same deploy, strict TypeScript, and a free hosting plan. The first prototype was an Express API with MongoDB and a separate Vite single-page app. It was replaced because it had two deploys, no server rendering, and did not run.

## Decision

- **Framework:** React Router **v8** in framework mode, server-side rendered, running on **Cloudflare Workers** through the official Cloudflare template (`create-cloudflare --framework=react-router`) and `@cloudflare/vite-plugin`.
- **Shape:** UI routes and resource routes (`api.*`, `webhooks.*`) live in `app/routes`. The Worker entry is `workers/app.ts` with a `fetch` and a `scheduled` handler. Code that touches the database, providers or secrets lives in `server/`, and ESLint stops UI building blocks from importing it.
- **Runtime configuration:** `wrangler.jsonc` with `nodejs_compat`, static assets, observability, typed bindings from `wrangler types`, and a `previews` block with preview-safe values. Environment variables are read only through a Zod-validated module that names the variable on failure and never prints its value.
- **Version:** v8, with Node 22.22 or newer and React 19.2.7 or newer.

### Why v8 and not v7

- The official Cloudflare template installs v8 today, so starting on v7 would mean changing generated code by hand and migrating later.
- The React Router team describes the v8 breaking changes as minimal, and all of them can be adopted while still on v7. For a new project there is nothing to migrate.
- v7 keeps receiving security updates, but no end-of-support date has been published, and the team plans a yearly major release. v6 and Remix v2 are already end of life.
- The Cloudflare dev proxy was removed in v8 in favor of `@cloudflare/vite-plugin`, which the template already uses.

## Alternatives considered

- **React Router v7.** Still supported for security fixes, but older, with no published end date. Rejected because it adds manual work now and a forced migration later.
- **Separate API and single-page app (the prototype).** Two deploys, no server rendering for link previews, and more moving parts. Rejected.
- **Other full-stack frameworks that need a Cloudflare adapter.** Not evaluated in depth: React Router has an official Cloudflare template and was already the owner's choice.
- **Remix 3.** The React Router team points to it for projects that share its principles, but it is in beta. Rejected for now.

## Consequences

**Good**

- One deploy for pages, API and webhooks, with a preview per pull request.
- Server rendering gives crawlers and link previews real HTML.
- Strict TypeScript from the route to the Worker entry.

**Costs and risks**

- **The Free plan is tight.** The Workers documentation (read on 2026-10-20) lists, for the Free plan: **10 ms of CPU time per HTTP request** and per Cron Trigger, **50 subrequests per invocation** (calls to the Cache API count), and 5 Cron Triggers per account. Server rendering and every loader must stay light, and the observability data should be watched for requests close to the CPU limit. The paid plan is the fallback if the limit becomes a real problem.
- **Bundle size.** The documentation states no compressed size limit and lists 64 MiB uncompressed for the Free plan. The Worker is about 190 kB compressed today.
- **Commercial use of the Free plan is not addressed.** Cloudflare's Self-Serve Subscription Agreement and the Workers pricing page neither forbid nor expressly grant commercial use of the Free plan, and Cloudflare may suspend Free services at its discretion. This does not matter while the project is non-commercial (see ADR-005), but it must be re-checked before any commercial use.
- **Newer major version.** There are fewer tutorials and answers for v8. The official documentation for the installed version is the reference, and `react-router-dom` must never be imported (removed in v8).
- **Worker Previews.** Cloudflare refuses to deploy a Worker without a `previews` block in its configuration. It was added in SAG-5 (see ADR-010).

## Open questions

- Whether real pages stay under the 10 ms CPU limit once they carry more data. Measure when the media pages (SAG-17) exist.

## References

- Cloudflare Workers limits, <https://developers.cloudflare.com/workers/platform/limits/> (read 2026-10-20)
- Cloudflare Workers pricing, <https://developers.cloudflare.com/workers/platform/pricing/> (read 2026-10-20)
- Cloudflare Self-Serve Subscription Agreement, <https://www.cloudflare.com/terms/> (read 2026-10-20)
- React Router v8 announcement, <https://remix.run/blog/react-router-v8> (read 2026-10-20)
- Upgrading from v7, <https://reactrouter.com/upgrading/v7> (read 2026-10-20)
