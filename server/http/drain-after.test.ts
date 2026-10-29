import { describe, expect, it } from "vitest";

import { answerAndDrain } from "./drain-after";

/** A POST whose body is a stream that says how much of it was read. */
function post(chunks: number, chunkBytes = 1024) {
  const state = { sent: 0, finished: false, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.sent >= chunks) {
        state.finished = true;
        controller.close();
        return;
      }
      state.sent += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  const request = new Request("https://sagashelf.test/library/add", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  return { request, state };
}

describe("answerAndDrain", () => {
  it("reads the body the handler left unread, before the answer is given back", async () => {
    const { request, state } = post(5);

    const response = await answerAndDrain(
      request,
      async () => new Response(null, { status: 403 }),
    );

    expect(response.status).toBe(403);
    expect(state.finished).toBe(true);
  });

  it("leaves alone a body that the handler read", async () => {
    const { request, state } = post(3);

    const response = await answerAndDrain(request, async () => {
      const text = await request.text();
      return new Response(String(text.length), { status: 200 });
    });

    expect(await response.text()).toBe(String(3 * 1024));
    expect(state.sent).toBe(3);
  });

  it("does nothing for a GET or a HEAD", async () => {
    for (const method of ["GET", "HEAD"]) {
      const request = new Request("https://sagashelf.test/", { method });

      const response = await answerAndDrain(
        request,
        async () => new Response("ok"),
      );

      expect(response.status).toBe(200);
      expect(request.bodyUsed).toBe(false);
    }
  });

  it("reads the body even when the handler fails, and lets the failure through", async () => {
    const { request, state } = post(4);

    await expect(
      answerAndDrain(request, async () => {
        throw new Error("the handler broke");
      }),
    ).rejects.toThrow("the handler broke");

    expect(state.finished).toBe(true);
  });

  it("gives up on a huge body instead of reading all of it", async () => {
    // 2 MB in 64 KB chunks: the limit of drainBody is 1 MB.
    const { request, state } = post(32, 64 * 1024);

    await answerAndDrain(
      request,
      async () => new Response(null, { status: 413 }),
    );

    expect(state.cancelled).toBe(true);
    expect(state.finished).toBe(false);
    expect(state.sent).toBeLessThan(32);
  });

  it("gives back the very answer of the handler", async () => {
    const { request } = post(1);
    const answer = new Response("body", {
      status: 201,
      headers: { "X-Test": "yes" },
    });

    const response = await answerAndDrain(request, async () => answer);

    expect(response).toBe(answer);
  });
});
