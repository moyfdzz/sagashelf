import http from "node:http";

import { expect, test } from "@playwright/test";

// A request that is refused before its body is read must not break the next one on the same
// connection (SAG-69). Playwright's own client opens connections as it likes, so a test that used
// it would fail only now and then. Here one connection is reused on purpose, which made the
// failure happen every time before the fix: the next request answered 500 ("fetch failed").

function send(
  agent: http.Agent,
  base: URL,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: Buffer } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: base.hostname,
        port: base.port,
        method,
        path,
        agent,
        headers: options.headers,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const boundary = "----sagashelf";
const form = (size: number) =>
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\npreview\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.json"\r\n` +
      `Content-Type: application/json\r\n\r\n${"x".repeat(size)}\r\n--${boundary}--\r\n`,
  );

test.describe("a refusal given before the body was read", () => {
  for (const size of [1000, 200_000]) {
    test(`does not break the next request on the same connection (${size} bytes)`, async ({
      baseURL,
    }) => {
      const base = new URL(baseURL ?? "http://localhost:4173");
      // One socket, kept open: the second request has to reuse the first one's connection.
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const statuses: { refused: number[]; next: number[] } = {
        refused: [],
        next: [],
      };

      try {
        for (let round = 0; round < 15; round += 1) {
          const body = form(size);
          statuses.refused.push(
            await send(agent, base, "POST", "/settings/import", {
              headers: {
                Origin: "https://evil.example",
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": String(body.length),
              },
              body,
            }),
          );
          statuses.next.push(await send(agent, base, "GET", "/api/health"));
        }
      } finally {
        agent.destroy();
      }

      // The form from another site is refused, and nothing after it is affected.
      expect(statuses.refused.every((status) => status >= 400)).toBe(true);
      expect(statuses.next.every((status) => status === 200)).toBe(true);
    });
  }
});
