import { pingDatabase } from "~server/db/health";
import { logUnhandled } from "~server/http/error-log";
import { getDb } from "~server/runtime-env";

// A paused Neon compute needs a second or two to wake; past this the answer is "unavailable".
const timeoutMs = 8_000;

const headers = { "Cache-Control": "no-store" };

// The log line keeps only the name of an error (SAG-134), so a timeout gets a name of its own to be
// told apart from a refused connection or a missing secret. The statement is not cancelled: the
// HTTP client of Neon has no way to do it, and one `select 1` left behind costs nothing.
function timeoutError() {
  const error = new Error("database health check timed out");
  error.name = "HealthCheckTimeout";
  return error;
}

/**
 * Whether the database answers (SAG-260). It is a route of its own because every call wakes the
 * compute of Neon: `/api/health` stays free for the monitor that runs every few minutes and for the
 * tests, and an uptime monitor calls this one rarely (docs/edge-setup.md). A failure is a 503 with
 * no detail: the name of the error (never its message) goes to the Worker logs only.
 */
export async function loader({ request }: { request: Request }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().then(pingDatabase),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
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
