import { describe, expect, it } from "vitest";

import {
  planClerkEvent,
  reservedUsernames,
  type ClerkEventLike,
} from "./clerk-user";

const updatedAt = Date.UTC(2026, 9, 21, 12, 0, 0);

function userEvent(
  overrides: Record<string, unknown> = {},
  type = "user.created",
): ClerkEventLike {
  return {
    type,
    timestamp: updatedAt + 5,
    data: {
      id: "user_abc",
      username: "ana_reads",
      first_name: "Ana",
      last_name: "Lopez",
      image_url: "https://img.clerk.com/abc",
      locale: "es-MX",
      primary_email_address_id: "idn_1",
      email_addresses: [
        {
          id: "idn_1",
          email_address: "Ana.Lopez+books@Gmail.com",
          verification: { status: "verified" },
        },
      ],
      updated_at: updatedAt,
      ...overrides,
    },
  };
}

describe("planClerkEvent: users", () => {
  it("mirrors a new user, with the canonical email and the user's own update time", () => {
    expect(planClerkEvent(userEvent())).toEqual({
      kind: "upsert",
      user: {
        clerkId: "user_abc",
        username: "ana_reads",
        displayName: "Ana Lopez",
        avatarUrl: "https://img.clerk.com/abc",
        emailCanonical: "analopez@gmail.com",
        locale: "es",
        at: new Date(updatedAt),
      },
    });
  });

  it("treats user.updated the same way", () => {
    expect(planClerkEvent(userEvent({}, "user.updated")).kind).toBe("upsert");
  });

  it("falls back to the event time when the user has no update time", () => {
    const plan = planClerkEvent(userEvent({ updated_at: undefined }));
    expect(plan).toMatchObject({
      kind: "upsert",
      user: { at: new Date(updatedAt + 5) },
    });
  });

  it("picks English from an English locale and Spanish otherwise", () => {
    const locale = (value: unknown) => {
      const plan = planClerkEvent(userEvent({ locale: value }));
      return plan.kind === "upsert" ? plan.user.locale : null;
    };
    expect(locale("en-US")).toBe("en");
    expect(locale("EN")).toBe("en");
    expect(locale("fr-FR")).toBe("es");
    expect(locale(null)).toBe("es");
  });

  it("leaves the display name empty when Clerk has no name, and joins what it has", () => {
    const name = (data: Record<string, unknown>) => {
      const plan = planClerkEvent(userEvent(data));
      return plan.kind === "upsert" ? plan.user.displayName : "not-upsert";
    };
    expect(name({ first_name: null, last_name: null })).toBeNull();
    expect(name({ first_name: "Ana", last_name: null })).toBe("Ana");
    expect(name({ first_name: "", last_name: "Lopez" })).toBe("Lopez");
  });

  it("keeps only an https avatar", () => {
    const avatar = (value: unknown) => {
      const plan = planClerkEvent(userEvent({ image_url: value }));
      return plan.kind === "upsert" ? plan.user.avatarUrl : "not-upsert";
    };
    expect(avatar("http://img.clerk.com/a")).toBeNull();
    expect(avatar("javascript:alert(1)")).toBeNull();
    expect(avatar("not a url")).toBeNull();
    expect(avatar(42)).toBeNull();
  });

  it("never reads a role from the event, even if one is sent", () => {
    const plan = planClerkEvent(
      userEvent({ public_metadata: { role: "admin" }, role: "admin" }),
    );
    expect(plan).toMatchObject({ kind: "upsert" });
    expect(JSON.stringify(plan)).not.toContain("admin");
  });
});

describe("planClerkEvent: refused accounts", () => {
  it("refuses a reserved username in any letter case", () => {
    for (const username of ["admin", "ADMIN", "Api", "settings", "sign-in"]) {
      expect(planClerkEvent(userEvent({ username }))).toEqual({
        kind: "reject",
        clerkId: "user_abc",
        reason: "reserved_username",
      });
    }
  });

  it("keeps every reserved name in lower case, so the comparison is exact", () => {
    for (const name of reservedUsernames) expect(name).toBe(name.toLowerCase());
  });

  it("refuses a missing, short, long or spaced username", () => {
    for (const username of [null, "", "ab", "x".repeat(31), "has space"]) {
      expect(planClerkEvent(userEvent({ username }))).toMatchObject({
        kind: "reject",
        reason: "invalid_username",
      });
    }
  });

  it("refuses an account whose primary email is not verified", () => {
    const unverified = [
      { id: "idn_1", email_address: "a@b.co", verification: null },
      {
        id: "idn_1",
        email_address: "a@b.co",
        verification: { status: "unverified" },
      },
    ];
    for (const email_addresses of unverified) {
      expect(
        planClerkEvent(userEvent({ email_addresses: [email_addresses] })),
      ).toMatchObject({ kind: "reject", reason: "no_verified_email" });
    }
  });

  it("refuses an account with no primary email, or a primary id that matches nothing", () => {
    expect(
      planClerkEvent(userEvent({ primary_email_address_id: null })),
    ).toMatchObject({ reason: "no_verified_email" });
    expect(
      planClerkEvent(userEvent({ primary_email_address_id: "idn_other" })),
    ).toMatchObject({ reason: "no_verified_email" });
    expect(
      planClerkEvent(userEvent({ email_addresses: "nope" })),
    ).toMatchObject({ reason: "no_verified_email" });
  });

  it("does not trust a verified secondary email when the primary is not verified", () => {
    const plan = planClerkEvent(
      userEvent({
        email_addresses: [
          { id: "idn_1", email_address: "a@b.co", verification: null },
          {
            id: "idn_2",
            email_address: "c@d.co",
            verification: { status: "verified" },
          },
        ],
      }),
    );
    expect(plan).toMatchObject({ kind: "reject", reason: "no_verified_email" });
  });

  it("refuses an email that cannot be made canonical", () => {
    expect(
      planClerkEvent(
        userEvent({
          email_addresses: [
            {
              id: "idn_1",
              email_address: "not-an-email",
              verification: { status: "verified" },
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: "reject", reason: "invalid_email" });
  });
});

describe("planClerkEvent: deletions and everything else", () => {
  it("plans a soft delete with the event time", () => {
    expect(
      planClerkEvent({
        type: "user.deleted",
        timestamp: updatedAt,
        data: { id: "user_abc", deleted: true, object: "user" },
      }),
    ).toEqual({ kind: "delete", clerkId: "user_abc", at: new Date(updatedAt) });
  });

  it("reads an event time given in seconds, as Clerk's own example does", () => {
    const seconds = 1_716_883_200;
    expect(
      planClerkEvent({
        type: "user.deleted",
        timestamp: seconds,
        data: { id: "user_abc" },
      }),
    ).toEqual({
      kind: "delete",
      clerkId: "user_abc",
      at: new Date(seconds * 1000),
    });
  });

  it("reads the same moment the same way in seconds and in milliseconds", () => {
    const at = (timestamp: number) => {
      const plan = planClerkEvent({
        type: "user.deleted",
        timestamp,
        data: { id: "user_abc" },
      });
      return plan.kind === "delete" ? plan.at.getTime() : null;
    };
    expect(at(1_716_883_200)).toBe(at(1_716_883_200_000));
  });

  it("ignores a time that is zero, negative or not a number", () => {
    for (const timestamp of [0, -5, Number.NaN, "1716883200", null]) {
      expect(
        planClerkEvent({
          type: "user.deleted",
          timestamp,
          data: { id: "user_abc" },
        }),
      ).toEqual({ kind: "ignore" });
    }
  });

  it("ignores a deletion with no id or no time", () => {
    expect(
      planClerkEvent({ type: "user.deleted", timestamp: 1, data: {} }),
    ).toEqual({ kind: "ignore" });
    expect(
      planClerkEvent({ type: "user.deleted", data: { id: "user_abc" } }),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores events about anything else", () => {
    for (const type of [
      "session.created",
      "email.created",
      "organization.created",
    ]) {
      expect(planClerkEvent({ type, timestamp: 1, data: {} })).toEqual({
        kind: "ignore",
      });
    }
  });

  it("ignores a user event without an id or a time, and a malformed body", () => {
    expect(planClerkEvent(userEvent({ id: undefined }))).toEqual({
      kind: "ignore",
    });
    expect(
      planClerkEvent({ type: "user.created", data: { id: "user_abc" } }),
    ).toEqual({ kind: "ignore" });
    expect(
      planClerkEvent({ type: "user.created", timestamp: 1, data: null }),
    ).toEqual({ kind: "ignore" });
    expect(
      planClerkEvent({ type: "user.deleted", timestamp: 1, data: null }),
    ).toEqual({ kind: "ignore" });
  });
});
