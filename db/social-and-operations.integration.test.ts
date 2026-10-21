import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  activity,
  auditLog,
  blocks,
  customEntries,
  follows,
  libraryEntries,
  likes,
  listItems,
  lists,
  mediaItems,
  outbox,
  processedWebhooks,
  reports,
  users,
  webhookDeliveries,
  webhookEndpoints,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, media_items, sagas, outbox, processed_webhooks RESTART IDENTITY CASCADE`,
  );
});

const noId = "00000000-0000-7000-8000-000000000000";

describe("custom entries", () => {
  it("give one title one entry, private and waiting for a moderator by default", async () => {
    const ana = await newUser();
    const title = await newMedia({ type: "custom", title: "My zine" });

    const [entry] = await db
      .insert(customEntries)
      .values({ mediaId: title.id, ownerId: ana.id })
      .returning();
    expect(entry).toMatchObject({
      visibility: "private",
      moderationState: "pending",
    });

    const error = await failsWith(
      db.insert(customEntries).values({ mediaId: title.id, ownerId: ana.id }),
    );
    expect(error.code).toBe("23505");
  });

  it("are removed with their owner, while the title itself stays", async () => {
    const ana = await newUser();
    const title = await newMedia({ type: "custom" });
    await db
      .insert(customEntries)
      .values({ mediaId: title.id, ownerId: ana.id });

    await db.delete(users).where(eq(users.id, ana.id));

    expect(await db.select().from(customEntries)).toHaveLength(0);
    expect(await db.select().from(mediaItems)).toHaveLength(1);
  });
});

describe("lists", () => {
  it("allow one list title per person, and the same title for two people", async () => {
    const [ana, bruno] = [await newUser(), await newUser()];
    await db.insert(lists).values({ ownerId: ana.id, title: "Best sci-fi" });

    const error = await failsWith(
      db.insert(lists).values({ ownerId: ana.id, title: "Best sci-fi" }),
    );
    expect(error.code).toBe("23505");

    await db.insert(lists).values({ ownerId: bruno.id, title: "Best sci-fi" });
    expect(await db.select().from(lists)).toHaveLength(2);
  });

  it("enforce the title and description lengths, and default to private", async () => {
    const ana = await newUser();
    const insert = (values: Partial<typeof lists.$inferInsert>) =>
      failsWith(
        db.insert(lists).values({ ownerId: ana.id, title: "T", ...values }),
      );

    expect((await insert({ title: "" })).code).toBe("23514");
    expect((await insert({ title: "x".repeat(101) })).code).toBe("23514");
    expect((await insert({ description: "x".repeat(501) })).code).toBe("23514");

    const [row] = await db
      .insert(lists)
      .values({ ownerId: ana.id, title: "Ok" })
      .returning();
    expect(row?.visibility).toBe("private");
  });

  it("hold a title once, and drop their items with the list or the title", async () => {
    const ana = await newUser();
    const [dune, film] = [await newMedia(), await newMedia()];
    const [list] = await db
      .insert(lists)
      .values({ ownerId: ana.id, title: "Mine" })
      .returning();
    const listId = list?.id ?? noId;
    await db.insert(listItems).values([
      { listId, mediaId: dune.id },
      { listId, mediaId: film.id, position: 1 },
    ]);

    const error = await failsWith(
      db.insert(listItems).values({ listId, mediaId: dune.id }),
    );
    expect(error.code).toBe("23505");

    await db.delete(mediaItems).where(eq(mediaItems.id, film.id));
    expect(await db.select().from(listItems)).toHaveLength(1);

    await db.delete(lists).where(eq(lists.id, listId));
    expect(await db.select().from(listItems)).toHaveLength(0);
  });
});

describe("follows and blocks", () => {
  it("reject a repeated follow, and allow the reverse one (that is what makes friends)", async () => {
    const [ana, bruno] = [await newUser(), await newUser()];
    await db
      .insert(follows)
      .values({ followerId: ana.id, followeeId: bruno.id });

    const error = await failsWith(
      db.insert(follows).values({ followerId: ana.id, followeeId: bruno.id }),
    );
    expect(error.code).toBe("23505");

    await db
      .insert(follows)
      .values({ followerId: bruno.id, followeeId: ana.id });
    expect(await db.select().from(follows)).toHaveLength(2);
  });

  it("reject following or blocking yourself", async () => {
    const ana = await newUser();

    expect(
      (
        await failsWith(
          db.insert(follows).values({ followerId: ana.id, followeeId: ana.id }),
        )
      ).code,
    ).toBe("23514");
    expect(
      (
        await failsWith(
          db.insert(blocks).values({ blockerId: ana.id, blockedId: ana.id }),
        )
      ).code,
    ).toBe("23514");
  });

  it("reject a repeated block, and refuse people that do not exist", async () => {
    const [ana, bruno] = [await newUser(), await newUser()];
    await db.insert(blocks).values({ blockerId: ana.id, blockedId: bruno.id });

    expect(
      (
        await failsWith(
          db.insert(blocks).values({ blockerId: ana.id, blockedId: bruno.id }),
        )
      ).code,
    ).toBe("23505");
    expect(
      (
        await failsWith(
          db.insert(follows).values({ followerId: ana.id, followeeId: noId }),
        )
      ).code,
    ).toBe("23503");
  });

  it("disappear with either person", async () => {
    const [ana, bruno, carla] = [
      await newUser(),
      await newUser(),
      await newUser(),
    ];
    await db.insert(follows).values([
      { followerId: ana.id, followeeId: bruno.id },
      { followerId: carla.id, followeeId: ana.id },
      { followerId: carla.id, followeeId: bruno.id },
    ]);

    await db.delete(users).where(eq(users.id, ana.id));

    const left = await db.select().from(follows);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      followerId: carla.id,
      followeeId: bruno.id,
    });
  });
});

describe("activity and likes", () => {
  it("start private with an empty payload", async () => {
    const ana = await newUser();

    const [row] = await db
      .insert(activity)
      .values({ actorId: ana.id, type: "completed" })
      .returning();

    expect(row).toMatchObject({ visibility: "private", payload: {} });
  });

  it("allow one like per person and event, and drop likes with the event", async () => {
    const [ana, bruno] = [await newUser(), await newUser()];
    const [event] = await db
      .insert(activity)
      .values({ actorId: ana.id, type: "started" })
      .returning();
    const activityId = event?.id ?? noId;
    await db.insert(likes).values({ userId: bruno.id, activityId });

    const error = await failsWith(
      db.insert(likes).values({ userId: bruno.id, activityId }),
    );
    expect(error.code).toBe("23505");

    await db.delete(activity).where(eq(activity.id, activityId));
    expect(await db.select().from(likes)).toHaveLength(0);
  });

  it("are removed with the title they are about", async () => {
    const ana = await newUser();
    const dune = await newMedia();
    await db.insert(activity).values({
      actorId: ana.id,
      type: "rated",
      mediaId: dune.id,
      payload: { score: 9 },
    });

    await db.delete(mediaItems).where(eq(mediaItems.id, dune.id));

    expect(await db.select().from(activity)).toHaveLength(0);
  });
});

describe("reports and the audit log", () => {
  it("let a person report the same thing once, and two people report it together", async () => {
    const [ana, bruno] = [await newUser(), await newUser()];
    const target = {
      targetType: "user",
      targetId: noId,
      reason: "spam",
    } as const;
    await db.insert(reports).values({ reporterId: ana.id, ...target });

    const error = await failsWith(
      db.insert(reports).values({ reporterId: ana.id, ...target }),
    );
    expect(error.code).toBe("23505");

    await db.insert(reports).values({ reporterId: bruno.id, ...target });
    const rows = await db.select().from(reports);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "open")).toBe(true);
  });

  it("outlive the account of the person who filed them", async () => {
    const ana = await newUser();
    await db.insert(reports).values({
      reporterId: ana.id,
      targetType: "list",
      targetId: noId,
      reason: "other",
    });

    await db.delete(users).where(eq(users.id, ana.id));

    const [report] = await db.select().from(reports);
    expect(report?.reporterId).toBeNull();
  });

  it("limit the details length", async () => {
    const error = await failsWith(
      db.insert(reports).values({
        targetType: "user",
        targetId: noId,
        reason: "spam",
        details: "x".repeat(1001),
      }),
    );
    expect(error.code).toBe("23514");
  });

  it("keep audit entries after the actor is deleted", async () => {
    const moderator = await newUser({ role: "moderator" });
    await db.insert(auditLog).values({
      actorId: moderator.id,
      action: "custom_entry.approved",
      targetId: noId,
    });

    await db.delete(users).where(eq(users.id, moderator.id));

    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      action: "custom_entry.approved",
      actorId: null,
      metadata: {},
    });
  });
});

describe("outbox", () => {
  const event = (key: string) => ({
    type: "library.completed",
    payload: { title: "Dune" },
    idempotencyKey: key,
  });

  it("start pending and due now", async () => {
    const [row] = await db.insert(outbox).values(event("a")).returning();

    expect(row).toMatchObject({
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    expect(row && row.nextAttemptAt.getTime() <= Date.now() + 1000).toBe(true);
  });

  it("refuse the same event twice, and make a retry a harmless no-op", async () => {
    await db.insert(outbox).values(event("same-event"));

    const error = await failsWith(
      db.insert(outbox).values(event("same-event")),
    );
    expect(error.code).toBe("23505");

    const retried = await db
      .insert(outbox)
      .values(event("same-event"))
      .onConflictDoNothing()
      .returning();
    expect(retried).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("refuse a negative attempt count", async () => {
    const error = await failsWith(
      db.insert(outbox).values({ ...event("b"), attempts: -1 }),
    );
    expect(error.code).toBe("23514");
  });

  it("are written in the same transaction as the change: if one fails, neither is kept", async () => {
    const ana = await newUser();
    const dune = await newMedia();
    await db.insert(outbox).values(event("taken"));

    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(libraryEntries)
          .values({ userId: ana.id, mediaId: dune.id });
        // Fails: this idempotency key already exists. The library entry above must go too.
        await tx.insert(outbox).values(event("taken"));
      }),
    ).rejects.toThrow();

    expect(await db.select().from(libraryEntries)).toHaveLength(0);
  });

  it("find the pending events that are due, oldest first", async () => {
    await db.insert(outbox).values([
      { ...event("late"), nextAttemptAt: new Date(Date.now() + 3_600_000) },
      { ...event("due-2"), nextAttemptAt: new Date(Date.now() - 1_000) },
      { ...event("due-1"), nextAttemptAt: new Date(Date.now() - 60_000) },
      { ...event("done"), status: "delivered" },
    ]);

    const due = await db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.status, "pending"),
          sql`${outbox.nextAttemptAt} <= now()`,
        ),
      )
      .orderBy(outbox.nextAttemptAt);

    expect(due.map((row) => row.idempotencyKey)).toEqual(["due-1", "due-2"]);
  });
});

describe("webhook endpoints and deliveries", () => {
  async function endpoint() {
    const ana = await newUser();
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        userId: ana.id,
        kind: "discord",
        url: "https://discord.com/api/webhooks/1/x",
      })
      .returning();
    if (!row) throw new Error("endpoint not created");
    return { ana, endpoint: row };
  }

  it("insist on HTTPS, a non-negative failure count, and start enabled", async () => {
    const { ana, endpoint: row } = await endpoint();
    expect(row).toMatchObject({
      enabled: true,
      failureCount: 0,
      eventTypes: [],
    });

    const insert = (values: Partial<typeof webhookEndpoints.$inferInsert>) =>
      failsWith(
        db.insert(webhookEndpoints).values({
          userId: ana.id,
          kind: "generic",
          url: "https://example.test/hook",
          ...values,
        }),
      );
    expect((await insert({ url: "http://example.test/hook" })).code).toBe(
      "23514",
    );
    expect((await insert({ failureCount: -1 })).code).toBe("23514");
  });

  it("record an attempt once, number attempts from 1, and cascade with the event", async () => {
    const { endpoint: hook } = await endpoint();
    const [queued] = await db
      .insert(outbox)
      .values({ type: "t", payload: {}, idempotencyKey: "k" })
      .returning();
    const outboxId = queued?.id ?? noId;
    const attempt = { endpointId: hook.id, outboxId };
    await db
      .insert(webhookDeliveries)
      .values({ ...attempt, attempt: 1, statusCode: 500 });

    expect(
      (
        await failsWith(
          db.insert(webhookDeliveries).values({ ...attempt, attempt: 1 }),
        )
      ).code,
    ).toBe("23505");
    expect(
      (
        await failsWith(
          db.insert(webhookDeliveries).values({ ...attempt, attempt: 0 }),
        )
      ).code,
    ).toBe("23514");

    await db
      .insert(webhookDeliveries)
      .values({ ...attempt, attempt: 2, statusCode: 204 });
    expect(await db.select().from(webhookDeliveries)).toHaveLength(2);

    await db.delete(outbox).where(eq(outbox.id, outboxId));
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it("disappear with their owner, deliveries included", async () => {
    const { ana, endpoint: hook } = await endpoint();
    const [queued] = await db
      .insert(outbox)
      .values({ type: "t", payload: {}, idempotencyKey: "k2" })
      .returning();
    await db.insert(webhookDeliveries).values({
      endpointId: hook.id,
      outboxId: queued?.id ?? noId,
      attempt: 1,
    });

    await db.delete(users).where(eq(users.id, ana.id));

    expect(await db.select().from(webhookEndpoints)).toHaveLength(0);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
  });
});

describe("processed webhooks", () => {
  it("handle an incoming event once: the second delivery is ignored", async () => {
    const first = await db
      .insert(processedWebhooks)
      .values({ provider: "clerk", eventId: "evt_1" })
      .onConflictDoNothing()
      .returning();
    const repeated = await db
      .insert(processedWebhooks)
      .values({ provider: "clerk", eventId: "evt_1" })
      .onConflictDoNothing()
      .returning();

    expect(first).toHaveLength(1);
    expect(repeated).toHaveLength(0);
  });

  it("reject a plain duplicate, and allow the same id from another provider", async () => {
    await db
      .insert(processedWebhooks)
      .values({ provider: "clerk", eventId: "evt_2" });

    const error = await failsWith(
      db
        .insert(processedWebhooks)
        .values({ provider: "clerk", eventId: "evt_2" }),
    );
    expect(error.code).toBe("23505");

    await db
      .insert(processedWebhooks)
      .values({ provider: "stripe", eventId: "evt_2" });
    expect(await db.select().from(processedWebhooks)).toHaveLength(2);
  });
});
