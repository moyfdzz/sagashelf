import { createRequestHandler } from "react-router";

import { apexRedirectUrl } from "~server/host";
import { applySecurityHeaders } from "~server/security-headers";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

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
