import { describe, expect, it } from "vitest";

import { readBoundedBody } from "./bounded-body";

/** A body that sends `chunks` pieces of `size` bytes and says nothing about its length. */
function chunked(chunks: number, size: number, onPull?: () => void) {
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        onPull?.();
        if (sent === chunks) return controller.close();
        sent += 1;
        controller.enqueue(new Uint8Array(size).fill(1));
      },
    }),
  );
}

describe("readBoundedBody", () => {
  it("returns the whole body when it fits", async () => {
    const bytes = await readBoundedBody(new Response("hello"), 10);

    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe("hello");
  });

  it("returns an empty body for an answer with no body", async () => {
    const bytes = await readBoundedBody(
      new Response(null, { status: 204 }),
      10,
    );

    expect(bytes?.byteLength).toBe(0);
  });

  it("refuses a declared length over the limit without reading it", async () => {
    let pulled = 0;
    const response = new Response(
      new ReadableStream({ pull: () => void (pulled += 1) }),
      { headers: { "Content-Length": "1000" } },
    );

    expect(await readBoundedBody(response, 100)).toBeNull();
    expect(pulled).toBe(0);
  });

  it("stops reading a chunked body as soon as it passes the limit", async () => {
    let pulls = 0;
    const response = chunked(1000, 10, () => (pulls += 1));

    expect(await readBoundedBody(response, 35)).toBeNull();
    // 4 chunks pass 35 bytes; the rest of the 1000 is never asked for.
    expect(pulls).toBeLessThan(10);
  });
});
