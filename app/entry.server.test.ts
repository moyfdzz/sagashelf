import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleError } from "./entry.server";

// The entry file imports the Worker's runtime, which only exists inside the Worker.
vi.mock("~server/runtime-env", () => ({ getClerkKeys: () => null }));

// Fake on purpose: obviously not a secret, and not high entropy.
const fakeAddress = "https://discord.example/api/webhooks/1/fake-address";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function failedStatement() {
  return new DrizzleQueryError(
    "insert into webhook_endpoints (user_id, url) values ($1, $2)",
    ["user-1", fakeAddress],
    Object.assign(new Error("duplicate key value"), { code: "23505" }),
  );
}

function handle() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  handleError(failedStatement(), {
    request: new Request("https://sagashelf.app/settings/notifications?x=1"),
  });
  return spy;
}

describe("handleError, the handler of every error that nobody handled (SAG-134)", () => {
  it("is what React Router calls, and in production writes no value of a failed statement", () => {
    vi.stubEnv("DEV", false);

    const spy = handle();

    expect(spy).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(spy.mock.calls);
    expect(written).toContain("request.failed");
    expect(written).toContain("23505");
    expect(written).toContain("/settings/notifications");
    expect(written).not.toContain(fakeAddress);
    expect(written).not.toContain("fake-address");
    expect(written).not.toContain("insert into");
    expect(written).not.toContain("user-1");
    expect(written).not.toContain("message");
  });

  it("adds the message only on the development server, whose data is fake", () => {
    vi.stubEnv("DEV", true);

    const written = JSON.stringify(handle().mock.calls);

    expect(written).toContain("message");
  });
});
