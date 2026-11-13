import { createRequestHandler } from "react-router";

import { answerAndDrain } from "~server/http/drain-after";
import { apexRedirectUrl } from "~server/host";
import { jobsForCron } from "~server/jobs/scheduled";
import { hasProviderCalls } from "~server/providers/call-log";
import { flushProviderCalls } from "~server/providers/flush";
import { applySecurityHeaders } from "~server/security-headers";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, _env, ctx) {
    // A refusal given before the body was read must not leave it half sent on the connection.
    const response = await answerAndDrain(request, async () => {
      const apexUrl = apexRedirectUrl(request.url);
      return apexUrl
        ? new Response(null, { status: 301, headers: { Location: apexUrl } })
        : requestHandler(request);
    });

    // The calls to the providers that this request made are written after the answer is sent, so
    // they add no time to it (SAG-26, ADR-052). With none, nothing runs.
    if (hasProviderCalls()) ctx.waitUntil(flushProviderCalls());

    // Every response the Worker produces carries the security headers.
    return applySecurityHeaders(response);
  },
  // The trigger lives in wrangler.jsonc. Each job is a small function in server/jobs (ADR-007).
  async scheduled(controller, _env, ctx) {
    // Each Cron Trigger is an invocation with its own subrequests (ADR-027, ADR-029).
    // The calls to the providers that the job made are written once it is done (one subrequest, which
    // the budgets in docs/agent-notes.md leave room for).
    ctx.waitUntil(
      (async () => {
        try {
          await jobsForCron(controller.cron)();
        } finally {
          await flushProviderCalls();
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
