import { createRequestHandler } from "react-router";
import * as serverBuild from "virtual:react-router/server-build";

import { apexRedirectUrl } from "~server/host";
import { applySecurityHeaders } from "~server/security-headers";

// The server build is imported here, when the Worker starts, and not with a lazy import() on
// the first request. A lazy import made that request evaluate 2.4 MiB of code: about 80 ms of
// CPU on Cloudflare, against the 10 ms of the Free plan. Starting has its own limit (1 second).
// See the CPU section of ADR-003.
const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

export default {
  async fetch(request) {
    const apexUrl = apexRedirectUrl(request.url);
    const response = apexUrl
      ? new Response(null, { status: 301, headers: { Location: apexUrl } })
      : await requestHandler(request);

    // Every response the Worker produces carries the security headers.
    return applySecurityHeaders(response);
  },
  // Cron jobs are added with their own tickets; the trigger lives in wrangler.jsonc.
  async scheduled() {},
} satisfies ExportedHandler<Env>;
