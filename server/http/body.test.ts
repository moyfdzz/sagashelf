import { describe, expect, it } from "vitest";

import { drainBody, readBody, readForm, readText } from "./body";

const post = (
  body: BodyInit | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) =>
  new Request("https://sagashelf.app/x", {
    method: "POST",
    body,
    headers,
    // A request that streams its body must say so.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);

/** A body that arrives in chunks and says nothing about its size, like a chunked upload. */
function chunked(...chunks: string[]) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, wasCancelled: () => cancelled };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return (thrown as { init?: { status: number } }).init?.status;
  }
  return undefined;
}

describe("readBody", () => {
  it("reads a body under the limit", async () => {
    const body = await readBody(post("hola"), 10);

    expect(new TextDecoder().decode(body)).toBe("hola");
  });

  it("reads a request with no body as empty", async () => {
    const body = await readBody(
      new Request("https://sagashelf.app/x", { method: "POST" }),
      10,
    );

    expect(body.byteLength).toBe(0);
  });

  it("refuses a body whose header says it is too big, without reading it", async () => {
    const { stream, wasCancelled } = chunked("x");

    expect(
      await rejection(readBody(post(stream, { "Content-Length": "11" }), 10)),
    ).toBe(413);
    expect(wasCancelled()).toBe(false);
  });

  it("refuses a body that grows past the limit when no header says its size", async () => {
    const { stream, wasCancelled } = chunked(
      "12345",
      "67890",
      "x",
      "never read",
    );

    expect(await rejection(readBody(post(stream), 10))).toBe(413);
    // The rest of the upload is not read.
    expect(wasCancelled()).toBe(true);
  });

  it("refuses a body that is bigger than its header says", async () => {
    const { stream } = chunked("a".repeat(50));

    expect(
      await rejection(readBody(post(stream, { "Content-Length": "5" }), 10)),
    ).toBe(413);
  });

  it("accepts a body of exactly the limit", async () => {
    const { stream } = chunked("12345", "67890");

    expect((await readBody(post(stream), 10)).byteLength).toBe(10);
  });

  it("counts bytes and not characters", async () => {
    // Four characters, eight bytes.
    expect(await rejection(readBody(post("ñññ" + "ñ"), 7))).toBe(413);
    expect((await readBody(post("ñññ" + "ñ"), 8)).byteLength).toBe(8);
  });
});

describe("readText", () => {
  it("decodes UTF-8", async () => {
    expect(await readText(post("canción"), 100)).toBe("canción");
  });
});

describe("readForm", () => {
  const form = (fields: Record<string, string>) =>
    post(new URLSearchParams(fields));

  it("reads the fields of a submitted form", async () => {
    expect(await readForm(form({ a: "1", b: "dos" }), 100)).toEqual({
      a: "1",
      b: "dos",
    });
  });

  it("reads a multipart form", async () => {
    const data = new FormData();
    data.set("name", "valor");

    expect(await readForm(post(data), 1000)).toEqual({ name: "valor" });
  });

  it("refuses a form that is too big", async () => {
    expect(await rejection(readForm(form({ a: "x".repeat(50) }), 20))).toBe(
      413,
    );
  });

  it("answers 400 for a body that is not a form", async () => {
    expect(
      await rejection(
        readForm(
          post(JSON.stringify({ a: 1 }), {
            "Content-Type": "application/json",
          }),
          100,
        ),
      ),
    ).toBe(400);
    expect(
      await rejection(
        readForm(
          post("---broken", {
            "Content-Type": "multipart/form-data; boundary=x",
          }),
          100,
        ),
      ),
    ).toBe(400);
  });
});

describe("drainBody", () => {
  it("reads a body to the end, so the answer does not leave it half sent", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 3) controller.close();
        else controller.enqueue(new TextEncoder().encode("abc"));
      },
    });
    const request = post(stream);

    await drainBody(request);

    expect(pulled).toBe(4);
  });

  it("stops at the limit and drops the rest of a body that is too big", async () => {
    const { stream, wasCancelled } = chunked("aaaa", "bbbb", "cccc", "dddd");

    await drainBody(post(stream), 6);

    expect(wasCancelled()).toBe(true);
  });

  it("does not touch a request that has no body to wait for", async () => {
    await expect(
      drainBody(new Request("https://sagashelf.app/x")),
    ).resolves.toBeUndefined();
    await expect(
      drainBody(new Request("https://sagashelf.app/x", { method: "HEAD" })),
    ).resolves.toBeUndefined();
    await expect(
      drainBody(new Request("https://sagashelf.app/x", { method: "POST" })),
    ).resolves.toBeUndefined();
  });

  it("never throws, whatever state the body is in", async () => {
    const used = post("hola");
    await used.text();
    const locked = post("hola");
    locked.body?.getReader();

    await expect(drainBody(used)).resolves.toBeUndefined();
    await expect(drainBody(locked)).resolves.toBeUndefined();
  });
});
