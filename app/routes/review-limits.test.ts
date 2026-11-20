import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as client from "~/lib/review-limits";
import * as server from "~server/reviews/rules";

describe("the limits of a review (SAG-22)", () => {
  it("are the same in the form and on the server", () => {
    expect(client.reviewMinLength).toBe(server.reviewMinLength);
    expect(client.reviewMaxLength).toBe(server.reviewMaxLength);
  });

  it("are the ones of the check constraint of the database", () => {
    const schema = readFileSync("server/db/schema/reviews.ts", "utf8");
    expect(schema).toContain(
      `BETWEEN ${server.reviewMinLength} AND ${server.reviewMaxLength}`,
    );
  });

  it("count the text the same way", () => {
    const body = " Una 🎬 reseña\r\ncon salto ";
    expect(client.reviewLength(body)).toBe(
      server.reviewLength(server.normalizeReviewBody(body)),
    );
  });
});
