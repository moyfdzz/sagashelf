import { DrizzleQueryError } from "drizzle-orm/errors";
import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { describeError, logUnhandled } from "./error-log";

// Fake on purpose: obviously not a secret, and not high entropy, so no scanner takes it for one.
const fakeAddress = "https://discord.example/api/webhooks/1/fake-address";
const fakeNote = "my private note about fake-person";

/** A failed statement as the Neon driver raises it: Drizzle's error, caused by Postgres' own. */
function failedStatement(params: unknown[] = ["user-1", fakeAddress]) {
  const postgres = Object.assign(new Error("duplicate key value"), {
    code: "23505",
    detail: `Key (url)=(${fakeAddress}) already exists.`,
  });
  return new DrizzleQueryError(
    "insert into webhook_endpoints (user_id, url) values ($1, $2)",
    params,
    postgres,
  );
}

const request = (path = "/settings/notifications?q=fake-search-text") =>
  new Request(`https://sagashelf.app${path}`);

/** Everything a line says, as the text that would reach the log. */
const written = (error: unknown, req?: Request) =>
  JSON.stringify(describeError(error, req));

afterEach(() => vi.restoreAllMocks());

describe("what is written for an error nobody handled (SAG-134)", () => {
  it("really would have carried the address, which is why the line must not (the old behavior)", () => {
    // The default of React Router prints the error as it is: its message holds the values.
    expect(failedStatement().message).toContain(fakeAddress);
    expect(failedStatement().message).toContain("insert into");
  });

  it("never writes the values, the statement, the message or the detail of a failed statement", () => {
    const line = written(failedStatement(), request());

    expect(line).not.toContain(fakeAddress);
    expect(line).not.toContain("fake-address");
    expect(line).not.toContain("insert into");
    expect(line).not.toContain("params");
    expect(line).not.toContain("Failed query");
    expect(line).not.toContain("duplicate key");
    expect(line).not.toContain("already exists");
    expect(line).not.toContain("user-1");
  });

  it("says what failed and where: the event, the name, the Postgres code and the path", () => {
    expect(describeError(failedStatement(), request())).toMatchObject({
      event: "request.failed",
      error: "Error",
      code: "23505",
      path: "/settings/notifications",
    });
  });

  it("leaves the query string out, since it can hold what somebody searched for", () => {
    expect(written(failedStatement(), request())).not.toContain(
      "fake-search-text",
    );
    expect(describeError(new Error("x"), request("/search?q=abc")).path).toBe(
      "/search",
    );
  });

  it("gives the first lines of the stack so the failure can be found, without the message", () => {
    const { frames } = describeError(failedStatement(), request());

    expect(frames?.length).toBeGreaterThan(0);
    expect(frames?.length).toBeLessThanOrEqual(3);
    for (const frame of frames ?? []) {
      expect(frame.startsWith("at ")).toBe(true);
      expect(frame).not.toContain(fakeAddress);
      expect(frame).not.toContain("Failed query");
    }
  });

  it("does not take a value with a line break for a line of the stack", () => {
    // A note typed by a person can contain a line that looks like a frame of the stack.
    const line = written(
      failedStatement([
        "user-1",
        `${fakeNote}\n    at evil (fake-file.ts:1:1)`,
      ]),
      request(),
    );

    expect(line).not.toContain("evil");
    expect(line).not.toContain("fake-file");
    expect(line).not.toContain(fakeNote);
  });

  it("gives no frames when the stack does not start with the message it should", () => {
    const odd = new Error("a message");
    odd.stack = "something else entirely\n    at somewhere (file.ts:1:1)";

    expect(describeError(odd).frames).toBeUndefined();
  });

  it("writes only a short code for something that is not an Error, never its text", () => {
    const line = written(`a thrown text with ${fakeAddress} in it`, request());

    expect(line).not.toContain(fakeAddress);
    expect(JSON.parse(line)).toMatchObject({ error: "NotAnError" });
  });

  it("does not trust a name that is not a class name", () => {
    const strange = Object.assign(new Error("m"), {
      name: `not a name ${fakeAddress}`,
    });

    const line = written(strange);

    expect(line).not.toContain(fakeAddress);
    expect(JSON.parse(line)).toMatchObject({ error: "Error" });
  });

  it("takes a code that is a Postgres code and no other", () => {
    const refused = Object.assign(new Error("m"), { code: "ECONNRESET" });
    const injected = Object.assign(new Error("m"), { code: fakeAddress });

    expect(describeError(refused).code).toBeUndefined();
    expect(describeError(injected).code).toBeUndefined();
  });

  it("writes the status of a response that was thrown, and not what it carried", () => {
    const refused = new ErrorResponseImpl(403, "Forbidden", {
      error: "forbidden",
      note: fakeNote,
    });

    const line = written(refused, request("/admin/sagas"));

    expect(JSON.parse(line)).toMatchObject({
      error: "ErrorResponse",
      status: 403,
      path: "/admin/sagas",
    });
    expect(line).not.toContain(fakeNote);
  });

  it("describes the error inside a response that was thrown, with the same care", () => {
    // React Router sets `error` on the response after making it.
    const wrapped = Object.assign(new ErrorResponseImpl(500, "Error", null), {
      error: failedStatement(),
    });

    const line = written(wrapped, request());

    expect(JSON.parse(line)).toMatchObject({ status: 500, code: "23505" });
    expect(line).not.toContain(fakeAddress);
  });

  it("adds the message only when it is asked to, for the development server", () => {
    const error = new Error("a message of the development server");

    expect(describeError(error).message).toBeUndefined();
    expect(describeError(error, undefined, { verbose: true }).message).toBe(
      "a message of the development server",
    );
  });

  it("copes with a request that has no usable address", () => {
    const broken = { url: "not a url", signal: new AbortController().signal };

    expect(
      describeError(new Error("x"), broken as Request).path,
    ).toBeUndefined();
  });
});

describe("writing it (logUnhandled)", () => {
  it("writes one line of JSON, and nothing that holds a value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logUnhandled(failedStatement(), request());

    expect(spy).toHaveBeenCalledTimes(1);
    const [text, ...rest] = spy.mock.calls[0] ?? [];
    expect(rest).toEqual([]);
    expect(typeof text).toBe("string");
    expect(JSON.parse(text as string)).toMatchObject({ code: "23505" });
    expect(text).not.toContain(fakeAddress);
  });

  it("writes nothing for a client that already left", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = new AbortController();
    controller.abort();

    logUnhandled(
      failedStatement(),
      new Request("https://sagashelf.app/library", {
        signal: controller.signal,
      }),
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
