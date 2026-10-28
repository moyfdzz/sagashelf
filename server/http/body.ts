import { data } from "react-router";

/**
 * Reads the body of a request, and stops reading once it passes `maxBytes`. The `Content-Length`
 * header is checked first, but a client can leave it out (a chunked body) or lie, so the bytes
 * that actually arrive are counted too. Throws a 413 when the body is too big.
 */
export async function readBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const tooBig = () => data({ error: "payload_too_large" }, { status: 413 });

  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) {
    throw tooBig();
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      // Stop the upload instead of reading the rest of it.
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The text of a body, with the same limit. */
export async function readText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder().decode(await readBody(request, maxBytes));
}

/**
 * The fields of a submitted form, with the same limit. A body that is not a form (or is broken)
 * is a 400, so the caller only ever sees fields.
 */
export async function readForm(
  request: Request,
  maxBytes: number,
): Promise<Record<string, FormDataEntryValue>> {
  const body = await readBody(request, maxBytes);
  try {
    const form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    }).formData();
    return Object.fromEntries(form);
  } catch {
    throw data({ error: "invalid_request" }, { status: 400 });
  }
}

/**
 * Reads and throws away what is left of the body of a request, so that an answer given before the
 * body was read (a refusal, a redirect to sign in) does not leave it half sent on the connection.
 * With Miniflare, which runs the app in development, in the tests and in the preview, an unread
 * body breaks the connection and the next requests answer 500 ("fetch failed"). Only GET and HEAD
 * have no body to wait for. It stops after `maxBytes` and drops the rest. It never throws.
 */
export async function drainBody(
  request: Request,
  maxBytes = 1024 * 1024,
): Promise<void> {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (!request.body || request.bodyUsed) return;
  try {
    const reader = request.body.getReader();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // A locked or broken stream has nothing left to wait for.
  }
}
