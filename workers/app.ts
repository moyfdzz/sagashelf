import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  // Cron jobs are added with their own tickets; the trigger lives in wrangler.jsonc.
  async scheduled() {},
} satisfies ExportedHandler<Env>;
