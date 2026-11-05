import { isRouteErrorResponse } from "react-router";

/**
 * How an error that nobody handled is written to the logs (SAG-134, ADR-006). The log of the
 * Worker is read by the owner and by Cloudflare, and an error can carry the values of a failed
 * statement: Drizzle puts `params: <values>` in the message of a failed query, and those values
 * are the private notes of an entry, usernames and the address of a Discord webhook, which is a
 * secret. So a line says what failed and where, never what it was holding: the name of the error,
 * the status, the path without its query, the code Postgres gave, and the first lines of the
 * stack without its message.
 */

export type ErrorLine = {
  event: "request.failed";
  error: string;
  status?: number;
  code?: string;
  path?: string;
  frames?: string[];
  /** Only for the development server, where every value is fake. */
  message?: string;
};

/** The five characters of a SQLSTATE, such as `23505`: a code, never a value. */
const sqlState = /^[0-9A-Z]{5}$/;
/** An error name is a class name. Anything else is not trusted to be one. */
const safeName = /^[A-Za-z][A-Za-z0-9_.$-]{0,59}$/;
const frameCount = 3;
const frameLength = 200;

/** The code Postgres gave, looked for in the error and in what caused it. */
function postgresCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && sqlState.test(code)) return code;
    current = current.cause;
  }
  return undefined;
}

/**
 * The first lines of the stack, after the header that holds the message. If the stack does not
 * start with the header as it is expected, it gives none: a value with a line break in it could
 * otherwise look like a line of the stack.
 */
function stackFrames(error: Error): string[] {
  const header = error.message ? `${error.name}: ${error.message}` : error.name;
  const stack = error.stack ?? "";
  if (!stack.startsWith(header)) return [];
  return stack
    .slice(header.length)
    .split("\n")
    .filter((line) => /^ {4}at /.test(line))
    .slice(0, frameCount)
    .map((line) => line.trim().slice(0, frameLength));
}

export function describeError(
  error: unknown,
  request?: Request,
  options: { verbose?: boolean } = {},
): ErrorLine {
  // A response thrown by a loader keeps the error that caused it in `error`. React Router reads
  // it the same way, but its type does not declare it.
  const response = isRouteErrorResponse(error) ? error : undefined;
  const cause = response ? (response as { error?: unknown }).error : error;

  const line: ErrorLine = {
    event: "request.failed",
    error:
      cause instanceof Error && safeName.test(cause.name)
        ? cause.name
        : cause instanceof Error
          ? "Error"
          : response
            ? "ErrorResponse"
            : "NotAnError",
  };
  if (response) line.status = response.status;
  const code = postgresCode(cause);
  if (code) line.code = code;
  if (request) {
    try {
      line.path = new URL(request.url).pathname;
    } catch {
      // A request with no usable address is logged without one.
    }
  }
  if (cause instanceof Error) {
    const frames = stackFrames(cause);
    if (frames.length > 0) line.frames = frames;
    if (options.verbose) line.message = cause.message;
  }
  return line;
}

/** Writes the line of an error nobody handled. Nothing is written for a client that left. */
export function logUnhandled(
  error: unknown,
  request: Request,
  options: { verbose?: boolean } = {},
): void {
  if (request.signal.aborted) return;
  console.error(JSON.stringify(describeError(error, request, options)));
}
