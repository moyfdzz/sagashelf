import { pingDatabase } from "~server/db/health";
import { logUnhandled } from "~server/http/error-log";
import { getDb } from "~server/runtime-env";

// A paused Neon compute needs a second or two to wake; past this the answer is "unavailable".
const timeoutMs = 8_000;

const headers = { "Cache-Control": "no-store" };

/**
 * Whether the database answers (SAG-260). It is a route of its own because every call wakes the
 * compute of Neon: `/api/health` stays free for the monitor that runs every few minutes and for the
 * tests, and an uptime monitor calls this one rarely (docs/edge-setup.md). A failure is a 503 with
 * no detail: the reason (a missing secret, a refused connection) goes to the Worker logs only.
 */
export async function loader({ request }: { request: Request }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().then(pingDatabase),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database health check timed out")),
          timeoutMs,
        );
      }),
    ]);
    return Response.json({ status: "ok" }, { headers });
  } catch (error) {
    logUnhandled(error, request);
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
