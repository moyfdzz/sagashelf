import { describe, expect, it } from "vitest";

import {
  contactCreatedType,
  contactKinds,
  contactNotice,
  dailyMemberCap,
  dailyVisitorCap,
  isContactKind,
  maxContactBody,
} from "./contact-schema";

describe("contact-schema (SAG-110)", () => {
  it("knows the three kinds and nothing else", () => {
    expect(contactKinds).toEqual(["feedback", "problem", "help"]);
    for (const kind of contactKinds) expect(isContactKind(kind)).toBe(true);
    for (const value of ["Feedback", "other", "", null, undefined, 3]) {
      expect(isContactKind(value)).toBe(false);
    }
  });

  it("keeps the numbers the plan agreed on", () => {
    expect(maxContactBody).toBe(2000);
    expect(dailyMemberCap).toBe(5);
    expect(dailyVisitorCap).toBe(50);
    expect(contactCreatedType).toBe("contact.created");
  });

  it("reads a notification as its kind only, and refuses what it cannot read", () => {
    expect(
      contactNotice({ kind: "help", body: "text", username: "a" }),
    ).toEqual({ kind: "help" });
    expect(contactNotice({ kind: "x" })).toBeNull();
    expect(contactNotice({})).toBeNull();
  });
});
