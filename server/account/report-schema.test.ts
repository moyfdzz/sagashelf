import { describe, expect, it } from "vitest";

import {
  canCancelReport,
  reasonsOf,
  reportFormSchema,
  reportNotice,
  warningNotice,
  warningType,
} from "./report-schema";

const report = (fields: Record<string, string>) =>
  reportFormSchema.safeParse({ intent: "report", ...fields });

describe("the reasons of a report", () => {
  // Written by hand: these are what the owner agreed.
  it("are the agreed ones for a picture and for a person", () => {
    expect(reasonsOf("picture")).toEqual([
      "sexual_content",
      "sexual_minors",
      "other_person",
      "violent",
      "other",
    ]);
    expect(reasonsOf("user")).toEqual([
      "spam",
      "harassment",
      "impersonation",
      "hate",
      "other",
    ]);
  });

  it("are refused on the wrong kind, and when unknown", () => {
    expect(report({ kind: "user", reason: "sexual_minors" }).success).toBe(
      false,
    );
    expect(report({ kind: "picture", reason: "spam" }).success).toBe(false);
    expect(report({ kind: "user", reason: "inappropriate" }).success).toBe(
      false,
    );
  });
});

describe("the form of a report", () => {
  it("needs no text, except for the reason other", () => {
    expect(report({ kind: "user", reason: "spam" }).success).toBe(true);

    const empty = report({ kind: "user", reason: "other", details: "   " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("details_required");

    expect(
      report({ kind: "user", reason: "other", details: "why" }).success,
    ).toBe(true);
  });

  it("refuses text over the limit and a field it does not have", () => {
    expect(
      report({ kind: "user", reason: "spam", details: "x".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      report({ kind: "user", reason: "spam", reporterId: "someone" }).success,
    ).toBe(false);
    expect(
      report({ kind: "picture", reason: "spam", pictureUrl: "x" }).success,
    ).toBe(false);
  });

  it("asks a real id to cancel", () => {
    expect(
      reportFormSchema.safeParse({ intent: "cancel", id: "not-an-id" }).success,
    ).toBe(false);
    expect(
      reportFormSchema.safeParse({
        intent: "cancel",
        id: "018f0000-0000-7000-8000-000000000000",
      }).success,
    ).toBe(true);
  });
});

describe("canCancelReport", () => {
  it("lets an open report go, but never one of minors or one that was answered", () => {
    expect(canCancelReport({ reason: "spam", status: "open" })).toBe(true);
    expect(canCancelReport({ reason: "sexual_minors", status: "open" })).toBe(
      false,
    );
    for (const status of ["reviewing", "resolved", "dismissed"]) {
      expect(canCancelReport({ reason: "spam", status })).toBe(false);
    }
  });
});

describe("reportNotice", () => {
  it("reads a good payload", () => {
    expect(
      reportNotice({ kind: "picture", reason: "violent", username: "ana" }),
    ).toEqual({ kind: "picture", reason: "violent", username: "ana" });
  });

  it("leaves out anything it cannot read", () => {
    expect(reportNotice({})).toBeNull();
    expect(
      reportNotice({ kind: "list", reason: "spam", username: "ana" }),
    ).toBeNull();
    expect(
      reportNotice({ kind: "user", reason: "nope", username: "ana" }),
    ).toBeNull();
    expect(reportNotice({ kind: "user", reason: "spam" })).toBeNull();
  });
});

describe("warningNotice", () => {
  it("reads the kind and the reason, and nothing else", () => {
    expect(
      warningNotice({
        kind: "picture",
        reason: "violent",
        reporter: "ana",
        pictureUrl: "https://img.clerk.com/x",
      }),
    ).toEqual({ kind: "picture", reason: "violent" });
  });

  it("leaves out anything it cannot read", () => {
    expect(warningNotice({})).toBeNull();
    expect(warningNotice({ kind: "list", reason: "spam" })).toBeNull();
    expect(warningNotice({ kind: "user", reason: "nope" })).toBeNull();
    expect(warningNotice({ kind: "user" })).toBeNull();
  });

  it("has a type of its own, which the table of notifications allows", () => {
    expect(warningType).toBe("moderation.warning");
  });
});
