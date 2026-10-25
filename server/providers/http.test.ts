import { describe, expect, it, vi } from "vitest";

import { createHttpClient, ProviderError, providerUserAgent } from "./http";

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response("{}", { status: code });

/** A client with a fake clock, so no test waits for real time. */
function setup(
  fetchImpl: typeof fetch,
  options: Partial<Parameters<typeof createHttpClient>[0]> = {},
) {
  let time = 1_000_000;
  const sleeps: number[] = [];
  const client = createHttpClient({
    provider: "demo",
    ratePerSecond: 1000,
    fetch: fetchImpl,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    random: () => 1,
    ...options,
  });
  return {
    client,
    sleeps,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    return error as ProviderError;
  }
  throw new Error("Expected the call to fail");
}

describe("getJson", () => {
  it("returns the JSON and sends the User-Agent, the headers and a GET", async () => {
    const fetchMock = vi.fn(async () => ok({ a: 1 }));
    const { client } = setup(fetchMock as unknown as typeof fetch, {
      headers: { Authorization: "Bearer demo-token" },
    });

    expect(await client.getJson("https://api.test/x")).toEqual({ a: 1 });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      "User-Agent": providerUserAgent,
      Authorization: "Bearer demo-token",
    });
  });

  it("identifies the app and a way to reach its owner", () => {
    expect(providerUserAgent).toContain("SagaShelf");
    expect(providerUserAgent).toContain("contact@sagashelf.app");
  });

  it("retries a server error and answers when the next try works", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(ok({ done: true }));
    const { client, sleeps } = setup(fetchMock as unknown as typeof fetch);

    expect(await client.getJson("https://api.test/x")).toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 200 ms with the random factor at its top: a pause between half and the whole value.
    expect(sleeps).toContain(200);
  });

  it("pauses longer before each retry and gives up after the retries", async () => {
    const fetchMock = vi.fn(async () => status(500));
    const { client, sleeps } = setup(fetchMock as unknown as typeof fetch, {
      retries: 2,
    });

    const error = await failureOf(client.getJson("https://api.test/x"));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps.filter((ms) => ms >= 200)).toEqual([200, 400]);
  });

  it("retries a 429 too", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok());
    const { client } = setup(fetchMock as unknown as typeof fetch);

    await client.getJson("https://api.test/x");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a request that was wrong (404, 401)", async () => {
    for (const code of [404, 401]) {
      const fetchMock = vi.fn(async () => status(code));
      const { client } = setup(fetchMock as unknown as typeof fetch);

      const error = await failureOf(client.getJson("https://api.test/x"));

      expect(error.status).toBe(code);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up with a timeout when the provider does not answer in time", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const { client } = setup(fetchMock as unknown as typeof fetch, {
      timeoutMs: 15,
      retries: 0,
    });

    const error = await failureOf(client.getJson("https://api.test/x"));

    expect(error.kind).toBe("timeout");
  });

  it("does not retry when the caller cancels", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const { client } = setup(fetchMock as unknown as typeof fetch);

    await failureOf(
      client.getJson("https://api.test/x", { signal: controller.signal }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the URL, the token or the body in the error", async () => {
    const fetchMock = vi.fn(
      async () => new Response("secret-body demo-token", { status: 500 }),
    );
    const { client } = setup(fetchMock as unknown as typeof fetch, {
      headers: { Authorization: "Bearer demo-token" },
      retries: 0,
    });

    const error = await failureOf(
      client.getJson("https://api.test/x?key=secret-key"),
    );

    expect(error.message).toBe("demo: http 500");
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(error.message).not.toContain("demo-token");
  });
});

describe("rate limit", () => {
  it("waits for a free place when the bucket is empty", async () => {
    const fetchMock = vi.fn(async () => ok());
    const { client, sleeps } = setup(fetchMock as unknown as typeof fetch, {
      ratePerSecond: 2,
      burst: 1,
    });

    await client.getJson("https://api.test/1");
    await client.getJson("https://api.test/2");

    // At 2 per second the second call waits half a second.
    expect(sleeps).toEqual([500]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to wait longer than it is allowed to", async () => {
    const fetchMock = vi.fn(async () => ok());
    const { client } = setup(fetchMock as unknown as typeof fetch, {
      ratePerSecond: 1,
      burst: 1,
      maxWaitMs: 100,
    });
    await client.getJson("https://api.test/1");

    const error = await failureOf(client.getJson("https://api.test/2"));

    expect(error.kind).toBe("rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not count a call it never sent against the provider", async () => {
    const fetchMock = vi.fn(async () => ok());
    const { client, advance } = setup(fetchMock as unknown as typeof fetch, {
      ratePerSecond: 1,
      burst: 1,
      maxWaitMs: 100,
      failureThreshold: 1,
    });
    await client.getJson("https://api.test/1");
    await failureOf(client.getJson("https://api.test/2"));
    advance(1500);

    // The circuit did not open: the next call goes through.
    expect(await client.getJson("https://api.test/3")).toEqual({ ok: true });
  });
});

describe("circuit breaker", () => {
  const breaker = { retries: 0, failureThreshold: 3, openMs: 30_000 };

  it("stops calling a provider that keeps failing, then tries again later", async () => {
    const fetchMock = vi.fn(async () => status(503));
    const { client, advance } = setup(
      fetchMock as unknown as typeof fetch,
      breaker,
    );

    for (let i = 0; i < 3; i += 1) {
      await failureOf(client.getJson("https://api.test/x"));
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Open: the call is refused without being sent.
    const refused = await failureOf(client.getJson("https://api.test/x"));
    expect(refused.kind).toBe("circuit_open");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // After the pause one call goes through to see whether the provider is back.
    advance(30_001);
    fetchMock.mockImplementation(async () => ok({ back: true }));
    expect(await client.getJson("https://api.test/x")).toEqual({ back: true });
    expect(await client.getJson("https://api.test/x")).toEqual({ back: true });
  });

  it("opens again when the call that tests the provider fails", async () => {
    const fetchMock = vi.fn(async () => status(500));
    const { client, advance } = setup(
      fetchMock as unknown as typeof fetch,
      breaker,
    );
    for (let i = 0; i < 3; i += 1) {
      await failureOf(client.getJson("https://api.test/x"));
    }

    advance(30_001);
    await failureOf(client.getJson("https://api.test/x"));
    const refused = await failureOf(client.getJson("https://api.test/x"));

    expect(refused.kind).toBe("circuit_open");
  });

  it("is not opened by answers that say the request was wrong", async () => {
    const fetchMock = vi.fn(async () => status(404));
    const { client } = setup(fetchMock as unknown as typeof fetch, breaker);

    for (let i = 0; i < 6; i += 1) {
      const error = await failureOf(client.getJson("https://api.test/x"));
      expect(error.status).toBe(404);
    }
  });

  it("starts counting again after a success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(500))
      .mockResolvedValueOnce(status(500))
      .mockResolvedValueOnce(ok())
      .mockResolvedValue(status(500));
    const { client } = setup(fetchMock as unknown as typeof fetch, breaker);

    await failureOf(client.getJson("https://api.test/x"));
    await failureOf(client.getJson("https://api.test/x"));
    await client.getJson("https://api.test/x");
    await failureOf(client.getJson("https://api.test/x"));
    await failureOf(client.getJson("https://api.test/x"));

    // Two failures after the success: still below three, so the call is sent.
    const error = await failureOf(client.getJson("https://api.test/x"));
    expect(error.kind).toBe("http");
  });
});
