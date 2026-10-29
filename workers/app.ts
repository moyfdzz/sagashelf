import { createRequestHandler } from "react-router";

import { answerAndDrain } from "~server/http/drain-after";
import { apexRedirectUrl } from "~server/host";
import { runScheduledJobs } from "~server/jobs/scheduled";
import { applySecurityHeaders } from "~server/security-headers";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    // A refusal given before the body was read must not leave it half sent on the connection.
    const response = await answerAndDrain(request, async () => {
      const apexUrl = apexRedirectUrl(request.url);
      return apexUrl
        ? new Response(null, { status: 301, headers: { Location: apexUrl } })
        : requestHandler(request);
    });

    // Every response the Worker produces carries the security headers.
    return applySecurityHeaders(response);
  },
  // The trigger lives in wrangler.jsonc. Each job is a small function in server/jobs (ADR-007).
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runScheduledJobs());
  },
} satisfies ExportedHandler<Env>;
