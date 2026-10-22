import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/webhooks.clerk";
import { action, loader } from "./webhooks.clerk";

// A secret made for these tests, in the shape Svix uses: "whsec_" and base64.
const encode = (text: string) => new TextEncoder().encode(text);
const keyBytes = encode("test-signing-key-for-the-unit-tests");
const secret = `whsec_${btoa(String.fromCharCode(...keyBytes))}`;

const mocks = vi.hoisted(() => ({
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  getSecret: vi.fn<() => string | null>(),
  getDb: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("~server/runtime-env", () => ({
  getWriteLimiter: () => ({ limit: mocks.limit }),
  getClerkWebhookSecret: mocks.getSecret,
  getDb: mocks.getDb,
}));
vi.mock("~server/db/clerk-sync", () => ({
  applyClerkOperation: mocks.apply,
}));

const db = { fake: "database" };

beforeEach(() => {
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.getSecret.mockReset().mockReturnValue(secret);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.apply.mockReset().mockResolvedValue("applied");
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

// The Standard Webhooks signature: HMAC-SHA256 over "id.timestamp.body", in base64.
async function sign(
  id: string,
  timestamp: number,
  body: string,
  key: Uint8Array<ArrayBuffer> = keyBytes,
) {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const userCreated = JSON.stringify({
  type: "user.created",
  object: "event",
  timestamp: 1_761_000_000_000,
  instance_id: "ins_test",
  data: {
    id: "user_ana",
    username: "ana_reads",
    first_name: "Ana",
    last_name: null,
    image_url: "https://img.clerk.com/ana",
    locale: "es-MX",
    primary_email_address_id: "idn_1",
    email_addresses: [
      {
        id: "idn_1",
        email_address: "ana@example.test",
        verification: { status: "verified" },
      },
    ],
    updated_at: 1_761_000_000_000,
  },
});

async function post(
  body: string,
  headers: Record<string, string> = {},
  { signed = true, id = "msg_1", timestamp = nowSeconds() } = {},
) {
  const signature = signed ? await sign(id, timestamp, body) : "";
  const request = new Request("http://localhost/webhooks/clerk", {
    method: "POST",
    headers: {
      ...(signed
        ? {
            "svix-id": id,
            "svix-timestamp": String(timestamp),
            "svix-signature": signature,
          }
        : {}),
      ...headers,
    },
    body,
  });
  return action({ request } as Route.ActionArgs) as Promise<Response>;
}

describe("POST /webhooks/clerk: a valid event", () => {
  it("applies the planned change with the verified svix-id", async () => {
    const response = await post(userCreated, {}, { id: "msg_abc" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "applied" });
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    const [database, eventId, operation] = mocks.apply.mock.calls[0] ?? [];
    expect(database).toBe(db);
    expect(eventId).toBe("msg_abc");
    expect(operation).toMatchObject({
      kind: "upsert",
      user: { clerkId: "user_ana", username: "ana_reads" },
    });
  });

  it("answers 200 for a duplicate delivery, as the store reports it", async () => {
    mocks.apply.mockResolvedValue("duplicate");

    const response = await post(userCreated);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate" });
  });

  it("answers 200 without opening the database for an event it does not use", async () => {
    const body = JSON.stringify({
      type: "session.created",
      object: "event",
      timestamp: 1,
      data: {},
    });

    const response = await post(body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/clerk: requests that must never reach the database", () => {
  async function expectRejected(response: Response, status = 401) {
    expect(response.status).toBe(status);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  }

  it("rejects a request with no signature headers", async () => {
    await expectRejected(await post(userCreated, {}, { signed: false }));
  });

  it("rejects a request with only some of the headers", async () => {
    await expectRejected(
      await post(userCreated, { "svix-id": "msg_1" }, { signed: false }),
    );
  });

  it("rejects a signature made with another secret", async () => {
    const timestamp = nowSeconds();
    const forged = await sign("msg_1", timestamp, userCreated, encode("other"));

    await expectRejected(
      await post(
        userCreated,
        {
          "svix-id": "msg_1",
          "svix-timestamp": String(timestamp),
          "svix-signature": forged,
        },
        { signed: false },
      ),
    );
  });

  it("rejects a body that was changed after it was signed", async () => {
    const timestamp = nowSeconds();
    const signature = await sign("msg_1", timestamp, userCreated);
    const tampered = userCreated.replace("ana_reads", "admin");

    await expectRejected(
      await post(
        tampered,
        {
          "svix-id": "msg_1",
          "svix-timestamp": String(timestamp),
          "svix-signature": signature,
        },
        { signed: false },
      ),
    );
  });

  it("rejects a replay older than five minutes, even with a valid signature", async () => {
    await expectRejected(
      await post(userCreated, {}, { timestamp: nowSeconds() - 6 * 60 }),
    );
  });

  it("rejects a timestamp too far in the future", async () => {
    await expectRejected(
      await post(userCreated, {}, { timestamp: nowSeconds() + 6 * 60 }),
    );
  });

  it("rejects an id swapped after signing", async () => {
    const timestamp = nowSeconds();
    const signature = await sign("msg_real", timestamp, userCreated);

    await expectRejected(
      await post(
        userCreated,
        {
          "svix-id": "msg_other",
          "svix-timestamp": String(timestamp),
          "svix-signature": signature,
        },
        { signed: false },
      ),
    );
  });

  it("does not say why a request was rejected", async () => {
    const response = await post(userCreated, {}, { signed: false });

    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  it("answers 503 when there is no signing secret, and never lets an event in", async () => {
    mocks.getSecret.mockReturnValue(null);

    await expectRejected(await post(userCreated), 503);
  });

  it("answers 429 when the caller is over the limit, before checking anything else", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    await expectRejected(await post(userCreated), 429);
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it("rejects a body that is too large before reading it", async () => {
    await expectRejected(
      await post(userCreated, { "Content-Length": "1000000" }),
      413,
    );
  });
});

describe("POST /webhooks/clerk: when the database fails", () => {
  it("answers 500 so Svix retries, and logs no personal data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.apply.mockRejectedValue(
      new Error("connection to ana@example.test failed"),
    );

    const response = await post(userCreated, {}, { id: "msg_fail" });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "try_again" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("msg_fail");
    expect(logged).not.toContain("example.test");
    expect(logged).not.toContain("ana_reads");
    log.mockRestore();
  });
});

describe("GET /webhooks/clerk", () => {
  it("is not allowed", async () => {
    const response = loader();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
