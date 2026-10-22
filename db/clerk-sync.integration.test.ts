import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  planClerkEvent,
  type ClerkEventLike,
  type ClerkOperation,
} from "../server/auth/clerk-user";
import { applyClerkOperation } from "../server/db/clerk-sync";
import { outbox, processedWebhooks, users } from "../server/db/schema";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, outbox, processed_webhooks RESTART IDENTITY CASCADE`,
  );
});

const t0 = Date.UTC(2026, 9, 21, 12, 0, 0);

function created(overrides: Record<string, unknown> = {}): ClerkEventLike {
  return {
    type: "user.created",
    timestamp: t0,
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
      updated_at: t0,
      ...overrides,
    },
  };
}

const plan = (event: ClerkEventLike): ClerkOperation => planClerkEvent(event);
const apply = (eventId: string, event: ClerkEventLike) =>
  applyClerkOperation(db, eventId, plan(event));

const allUsers = () => db.select().from(users);

describe("user.created", () => {
  it("creates the local user with defaults and the canonical email", async () => {
    expect(await apply("evt_1", created())).toBe("applied");

    const [row] = await allUsers();
    expect(row).toMatchObject({
      clerkId: "user_ana",
      username: "ana_reads",
      displayName: "Ana",
      emailCanonical: "ana@example.test",
      locale: "es",
      role: "user",
      privacy: "public",
      deletedAt: null,
    });
    expect(row?.clerkUpdatedAt.getTime()).toBe(t0);
  });
});

describe("replaying an event", () => {
  it("changes the database once, however many times it is delivered", async () => {
    const results = [
      await apply("evt_1", created()),
      await apply("evt_1", created()),
      await apply("evt_1", created()),
      await apply("evt_1", created()),
    ];

    expect(results).toEqual(["applied", "duplicate", "duplicate", "duplicate"]);
    expect(await allUsers()).toHaveLength(1);
    expect(await db.select().from(processedWebhooks)).toHaveLength(1);
  });

  it("does not undo a later change when an old event is replayed", async () => {
    await apply("evt_1", created());
    await apply(
      "evt_2",
      created({ username: "ana_new", updated_at: t0 + 1000 }),
    );

    expect(await apply("evt_1", created())).toBe("duplicate");
    expect((await allUsers())[0]?.username).toBe("ana_new");
  });
});

describe("ordering", () => {
  it("never overwrites newer data with an older event that arrives late", async () => {
    await apply(
      "evt_new",
      created({ username: "ana_newer", updated_at: t0 + 2000 }),
    );

    const late = await apply(
      "evt_old",
      created({ username: "ana_older", updated_at: t0 + 1000 }),
    );

    expect(late).toBe("stale");
    const [row] = await allUsers();
    expect(row?.username).toBe("ana_newer");
    expect(row?.clerkUpdatedAt.getTime()).toBe(t0 + 2000);
    // The late event is still recorded, so Svix retrying it does nothing either.
    expect(await apply("evt_old", created())).toBe("duplicate");
  });

  it("applies a newer update", async () => {
    await apply("evt_1", created());
    const result = await apply(
      "evt_2",
      created({ first_name: "Ana María", updated_at: t0 + 1000 }),
    );

    expect(result).toBe("applied");
    expect((await allUsers())[0]?.displayName).toBe("Ana María");
  });

  it("creates the user from an update when the created event was lost", async () => {
    const event = {
      ...created({ updated_at: t0 + 500 }),
      type: "user.updated",
    };
    expect(await apply("evt_u", event)).toBe("applied");
    expect(await allUsers()).toHaveLength(1);
  });

  it("treats the same timestamp as already applied", async () => {
    await apply("evt_1", created());
    const same = await apply("evt_2", created({ first_name: "Other" }));

    expect(same).toBe("stale");
    expect((await allUsers())[0]?.displayName).toBe("Ana");
  });
});

describe("what a sync never touches", () => {
  it("keeps the role, privacy, bio and language chosen here", async () => {
    await apply("evt_1", created());
    await db
      .update(users)
      .set({
        role: "admin",
        privacy: "private",
        bio: "My own bio",
        locale: "en",
      })
      .where(eq(users.clerkId, "user_ana"));

    await apply(
      "evt_2",
      created({ username: "ana_2", locale: "es-MX", updated_at: t0 + 1000 }),
    );

    expect((await allUsers())[0]).toMatchObject({
      username: "ana_2",
      role: "admin",
      privacy: "private",
      bio: "My own bio",
      locale: "en",
    });
  });
});

describe("user.deleted", () => {
  const deleted = (at: number): ClerkEventLike => ({
    type: "user.deleted",
    timestamp: at,
    data: { id: "user_ana", deleted: true, object: "user" },
  });

  it("soft deletes, clears the profile and keeps the names reserved", async () => {
    await apply("evt_1", created());
    await db
      .update(users)
      .set({ bio: "private thoughts" })
      .where(eq(users.clerkId, "user_ana"));

    expect(await apply("evt_del", deleted(t0 + 5000))).toBe("applied");

    const [row] = await allUsers();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row).toMatchObject({
      displayName: null,
      avatarUrl: null,
      bio: null,
      username: "ana_reads",
      emailCanonical: "ana@example.test",
      clerkId: "user_ana",
    });
  });

  it("does not bring the account back when a newer update arrives", async () => {
    await apply("evt_1", created());
    await apply("evt_del", deleted(t0 + 5000));

    const late = await apply(
      "evt_3",
      created({ first_name: "Back", updated_at: t0 + 9000 }),
    );

    expect(late).toBe("stale");
    expect((await allUsers())[0]).toMatchObject({ displayName: null });
    expect((await allUsers())[0]?.deletedAt).not.toBeNull();
  });

  it("ignores a deletion older than the data we hold", async () => {
    await apply("evt_1", created({ updated_at: t0 + 8000 }));

    expect(await apply("evt_del", deleted(t0 + 100))).toBe("stale");
    expect((await allUsers())[0]?.deletedAt).toBeNull();
  });

  it("is recorded and harmless when the user was never mirrored, and when replayed", async () => {
    expect(await apply("evt_del", deleted(t0))).toBe("stale");
    expect(await apply("evt_del", deleted(t0))).toBe("duplicate");
    expect(await allUsers()).toHaveLength(0);
  });
});

describe("accounts that are refused", () => {
  it("queues a follow-up, without personal data, when the username is reserved", async () => {
    const result = await apply("evt_r", created({ username: "admin" }));

    expect(result).toBe("rejected");
    expect(await allUsers()).toHaveLength(0);
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "clerk.user_rejected",
      payload: { clerkId: "user_ana", reason: "reserved_username" },
      idempotencyKey: "clerk:evt_r",
      status: "pending",
    });
    expect(JSON.stringify(rows[0]?.payload)).not.toContain("example.test");

    // Delivered again: still one follow-up.
    expect(await apply("evt_r", created({ username: "admin" }))).toBe(
      "duplicate",
    );
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("refuses an account whose email is not verified", async () => {
    const result = await apply(
      "evt_u",
      created({
        email_addresses: [
          {
            id: "idn_1",
            email_address: "ana@example.test",
            verification: null,
          },
        ],
      }),
    );

    expect(result).toBe("rejected");
    expect(await allUsers()).toHaveLength(0);
  });

  it("refuses a username that another account already has, in any letter case", async () => {
    await apply("evt_1", created());

    const result = await apply(
      "evt_2",
      created({
        id: "user_other",
        username: "ANA_READS",
        email_addresses: [
          {
            id: "idn_9",
            email_address: "other@example.test",
            verification: { status: "verified" },
          },
        ],
        primary_email_address_id: "idn_9",
      }),
    );

    expect(result).toBe("rejected");
    expect(await allUsers()).toHaveLength(1);
    expect(await db.select().from(outbox)).toMatchObject([
      { payload: { clerkId: "user_other", reason: "taken" } },
    ]);
  });

  it("refuses the same inbox written another way (dots and a plus tag at Gmail)", async () => {
    const gmail = (address: string) => [
      {
        id: "idn_1",
        email_address: address,
        verification: { status: "verified" },
      },
    ];
    await apply(
      "evt_1",
      created({ email_addresses: gmail("ana.reads@gmail.com") }),
    );

    const result = await apply(
      "evt_2",
      created({
        id: "user_second",
        username: "second_account",
        email_addresses: gmail("a.n.a.reads+shelf@GMAIL.com"),
      }),
    );

    expect(result).toBe("rejected");
    expect(await allUsers()).toHaveLength(1);
  });

  it("does not let a deleted account's username or email be taken", async () => {
    await apply("evt_1", created());
    await apply("evt_del", {
      type: "user.deleted",
      timestamp: t0 + 1,
      data: { id: "user_ana" },
    });

    const result = await apply(
      "evt_2",
      created({
        id: "user_new",
        email_addresses: [
          {
            id: "idn_1",
            email_address: "new@example.test",
            verification: { status: "verified" },
          },
        ],
      }),
    );

    expect(result).toBe("rejected");
  });
});

describe("events that are not about users", () => {
  it("are ignored and write nothing", async () => {
    const result = await apply("evt_s", {
      type: "session.created",
      timestamp: t0,
      data: {},
    });

    expect(result).toBe("ignored");
    expect(await db.select().from(processedWebhooks)).toHaveLength(0);
  });
});
