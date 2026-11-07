import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/contact";
import { action, headers, loader, meta } from "./contact";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  createContactMessage: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/db/contact-messages", () => ({
  createContactMessage: mocks.createContactMessage,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const origin = "https://sagashelf.app";

beforeEach(() => {
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  mocks.createContactMessage.mockReset().mockResolvedValue("sent");
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const load = (search = "") =>
  loader({
    request: new Request(`${origin}/contact${search}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

const submit = (form: Record<string, string>) =>
  action({
    request: new Request(`${origin}/contact`, {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams(form),
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs);

/** A redirect or a refusal built with `redirect()` or a `Response`. */
const asResponse = (value: unknown) => value as Response;

/** An answer built with `data()`: the data and the status it carries. */
type Answer = { data: Record<string, unknown>; init: { status: number } };
const asData = (value: unknown) => value as Answer;

describe("the loader of the contact page (SAG-110)", () => {
  it("says whether the person is signed in, and whether a message was just sent", async () => {
    expect(await load()).toMatchObject({ signedIn: false, sent: false });

    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    expect(await load("?sent=1")).toMatchObject({ signedIn: true, sent: true });
    expect(await load("?sent=yes")).toMatchObject({ sent: false });
  });

  it("gives the title and the description, and lets a suspended person be sent away", async () => {
    expect(await load()).toMatchObject({
      title: "app.pageTitle",
      description: "contact.description",
    });

    const away = new Response(null, { status: 302 });
    mocks.getOptionalUser.mockRejectedValue(away);
    await expect(load()).rejects.toBe(away);
  });

  it("is never kept by a shared cache and is not indexed", () => {
    expect(headers).toBeDefined();
    expect(
      meta({ loaderData: { title: "T", description: "D" } } as never),
    ).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

describe("sending a message", () => {
  it("stores what a visitor wrote, with the address, and goes back saying it was sent", async () => {
    const result = asResponse(
      await submit({
        kind: "help",
        body: "  I cannot sign in  ",
        replyEmail: "visitor@example.test",
      }),
    );

    expect(mocks.createContactMessage).toHaveBeenCalledWith(
      { fake: "database" },
      {
        userId: null,
        kind: "help",
        body: "I cannot sign in",
        replyEmail: "visitor@example.test",
      },
    );
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe("/contact?sent=1");
  });

  it("stores what a signed-in person wrote with their id from the session, and never an address", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });

    await submit({
      kind: "feedback",
      body: "I like it",
      replyEmail: "typed@example.test",
    });

    expect(mocks.createContactMessage).toHaveBeenCalledWith(
      { fake: "database" },
      {
        userId: "user-1",
        kind: "feedback",
        body: "I like it",
        replyEmail: null,
      },
    );
  });

  it("limits a visitor and a person apart, before it reads the form", async () => {
    await submit({ kind: "help", body: "a" });
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    await submit({ kind: "help", body: "a" });

    expect(mocks.limit.mock.calls.map((call) => call[0].key)).toEqual([
      "contact:visitor:unknown",
      "contact:user-1:unknown",
    ]);

    mocks.limit.mockResolvedValue({ success: false });
    mocks.createContactMessage.mockClear();
    const limited = asResponse(await submit({ kind: "help", body: "a" }));
    expect(limited.status).toBe(429);
    expect(mocks.createContactMessage).not.toHaveBeenCalled();
  });

  it("answers as if it was sent, and keeps nothing, when the trap field is filled", async () => {
    const result = asResponse(
      await submit({
        kind: "help",
        body: "buy now",
        website: "http://spam.example",
      }),
    );

    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe("/contact?sent=1");
    expect(mocks.createContactMessage).not.toHaveBeenCalled();
  });

  it("gives the form back with what was typed, and says what is wrong", async () => {
    const empty = asData(
      await submit({ kind: "help", body: "   ", replyEmail: "a@b.test" }),
    );
    expect(empty.init.status).toBe(400);
    expect(empty.data).toEqual({
      error: "body_invalid",
      values: { kind: "help", body: "   ", replyEmail: "a@b.test" },
    });

    const badEmail = asData(
      await submit({ kind: "problem", body: "Text", replyEmail: "nope" }),
    );
    expect(badEmail.data).toMatchObject({
      error: "email_invalid",
      values: { kind: "problem", body: "Text", replyEmail: "nope" },
    });

    const badKind = asData(await submit({ kind: "x", body: "Text" }));
    expect(badKind.data).toMatchObject({ error: "invalid_request" });
    const extra = asData(
      await submit({ kind: "help", body: "Text", userId: "x" }),
    );
    expect(extra.data).toMatchObject({ error: "invalid_request" });
    expect(mocks.createContactMessage).not.toHaveBeenCalled();
  });

  it("does not echo more than the limits allow", async () => {
    const result = asData(
      await submit({
        kind: "help",
        body: "x".repeat(2500),
        replyEmail: "e".repeat(400),
      }),
    );

    const values = result.data.values as { body: string; replyEmail: string };
    expect(values.body).toHaveLength(2000);
    expect(values.replyEmail).toHaveLength(254);
  });

  it("answers 429 with what was typed when the daily limit is over", async () => {
    mocks.createContactMessage.mockResolvedValue("limit");

    const result = asData(await submit({ kind: "help", body: "A question" }));

    expect(result.init.status).toBe(429);
    expect(result.data).toEqual({
      error: "limit",
      values: { kind: "help", body: "A question", replyEmail: "" },
    });
  });
});
