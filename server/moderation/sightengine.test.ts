import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../testing/msw";
import {
  safeScores,
  sightengineAnswers,
  sightengineEndpoint,
  type SeenCheck,
} from "../testing/sightengine";
import { moderatePicture, refuseFromScore } from "./sightengine";

const keys = { apiUser: "fake-user", apiSecret: "fake-secret" };
const picture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const check = () => moderatePicture(picture, "image/jpeg", keys);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("moderatePicture", () => {
  it("allows a picture with low scores", async () => {
    mswServer.use(sightengineAnswers({}));

    expect(await check()).toBe("allowed");
  });

  it.each(["sexual_activity", "sexual_display", "erotica", "very_suggestive"])(
    "refuses a picture with a score of 0.5 at %s, and allows one just under",
    async (level) => {
      expect(refuseFromScore).toBe(0.5);

      mswServer.use(sightengineAnswers({ [level]: 0.5 }));
      expect(await check()).toBe("rejected");

      mswServer.use(sightengineAnswers({ [level]: 0.49 }));
      expect(await check()).toBe("allowed");
    },
  );

  it("allows a suggestive picture, such as a swimsuit", async () => {
    mswServer.use(
      sightengineAnswers({ suggestive: 0.99, mildly_suggestive: 0.99 }),
    );

    expect(await check()).toBe("allowed");
  });

  it("sends the picture and the keys in the body, never in the address", async () => {
    const seen: SeenCheck[] = [];
    mswServer.use(sightengineAnswers({}, seen));

    await check();

    const [call] = seen;
    expect(call?.url.search).toBe("");
    expect(call?.form.get("models")).toBe("nudity-2.1");
    expect(call?.form.get("api_user")).toBe("fake-user");
    expect(call?.form.get("api_secret")).toBe("fake-secret");
    const media = call?.form.get("media") as File;
    expect(media.type).toBe("image/jpeg");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(picture);
  });

  it.each([
    [
      "an error of the plan",
      { status: "failure", error: { type: "usage_limit" } },
      429,
    ],
    ["a success with no scores", { status: "success" }, 200],
    ["a failure with an OK status", { status: "failure" }, 200],
    [
      "a broken score",
      { status: "success", nudity: { ...safeScores(), erotica: "low" } },
      200,
    ],
    ["a server error", {}, 500],
    [
      "scores that come with an error status",
      { status: "success", nudity: safeScores() },
      500,
    ],
  ])("says unavailable, not allowed, for %s", async (_name, body, status) => {
    mswServer.use(
      http.post(sightengineEndpoint, () => HttpResponse.json(body, { status })),
    );

    expect(await check()).toBe("unavailable");
  });

  it("says unavailable when the answer is not JSON or the service cannot be reached", async () => {
    mswServer.use(
      http.post(sightengineEndpoint, () => new HttpResponse("<html>")),
    );
    expect(await check()).toBe("unavailable");

    mswServer.use(http.post(sightengineEndpoint, () => HttpResponse.error()));
    expect(await check()).toBe("unavailable");
  });

  it("never writes the keys to a log", async () => {
    const logged = vi.spyOn(console, "error");
    mswServer.use(http.post(sightengineEndpoint, () => HttpResponse.error()));

    await check();

    expect(JSON.stringify(logged.mock.calls)).not.toContain("fake-secret");
  });
});
