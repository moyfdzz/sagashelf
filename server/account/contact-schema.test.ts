import { describe, expect, it } from "vitest";

import {
  contactCreatedType,
  contactFormError,
  contactFormSchema,
  contactKinds,
  contactNotice,
  contactTrapField,
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

describe("contactFormSchema (SAG-110)", () => {
  const ok = { kind: "help", body: "A question" };

  it("takes a kind and a text, trims the text, and reads no address as none", () => {
    expect(contactFormSchema.parse({ ...ok, body: "  hello  " })).toEqual({
      kind: "help",
      body: "hello",
      replyEmail: null,
    });
    expect(
      contactFormSchema.parse({ ...ok, replyEmail: "   " }).replyEmail,
    ).toBe(null);
    expect(
      contactFormSchema.parse({ ...ok, replyEmail: " ana@example.test " })
        .replyEmail,
    ).toBe("ana@example.test");
  });

  it("refuses a kind it does not know, an empty text and a text over 2000 characters", () => {
    expect(contactFormSchema.safeParse({ ...ok, kind: "spam" }).success).toBe(
      false,
    );
    expect(contactFormSchema.safeParse({ ...ok, body: "   " }).success).toBe(
      false,
    );
    expect(
      contactFormSchema.safeParse({ ...ok, body: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      contactFormSchema.safeParse({ ...ok, body: "x".repeat(2000) }).success,
    ).toBe(true);
  });

  it("refuses an address that is not one or is too long", () => {
    for (const replyEmail of [
      "not an email",
      "a@",
      "@b.test",
      `${"a".repeat(250)}@b.test`,
    ]) {
      expect(
        contactFormSchema.safeParse({ ...ok, replyEmail }).success,
        replyEmail,
      ).toBe(false);
    }
  });

  it("refuses any field it does not know, and takes the trap field as text", () => {
    expect(contactFormSchema.safeParse({ ...ok, userId: "x" }).success).toBe(
      false,
    );
    expect(contactTrapField).toBe("website");
    expect(
      contactFormSchema.safeParse({ ...ok, website: "http://spam" }).success,
    ).toBe(true);
  });

  it("says why a form was refused, in the terms of the page", () => {
    const why = (form: unknown) => {
      const result = contactFormSchema.safeParse(form);
      if (result.success) throw new Error("expected a refusal");
      return contactFormError(result.error);
    };

    expect(why({ ...ok, body: "" })).toBe("body_invalid");
    expect(why({ ...ok, replyEmail: "nope" })).toBe("email_invalid");
    expect(why({ ...ok, kind: "x" })).toBe("invalid_request");
    expect(why({ ...ok, extra: "x" })).toBe("invalid_request");
    // The text wins when both are wrong, since it is what the person has to fix first.
    expect(why({ ...ok, body: "", replyEmail: "nope" })).toBe("body_invalid");
  });
});
