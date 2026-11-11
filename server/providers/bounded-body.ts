/**
 * Reads the body of an answer and gives up, without keeping the rest in memory, when it passes
 * `maxBytes` (SAG-185). `Response.json()` and `arrayBuffer()` read all of a body, so a provider
 * that sends a huge or endless answer would fill the memory of the Worker. A body over the limit
 * gives `null`.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get("Content-Length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
