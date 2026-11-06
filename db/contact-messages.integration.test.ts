import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import {
  contactRetentionDays,
  dailyMemberCap,
  dailyVisitorCap,
} from "../server/account/contact-schema";
import {
  createContactMessage,
  deleteContactMessage,
  listContactMessages,
  pruneContactMessages,
  setContactMessageStatus,
  type NewContactMessage,
} from "../server/db/contact-messages";
import { eraseAccount } from "../server/db/erase-user";
import { auditLog, contactMessages, notifications } from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

const memberMessage = (
  userId: string,
  fields: Partial<NewContactMessage> = {},
): NewContactMessage => ({
  userId,
  kind: "problem",
  body: "The search is slow",
  replyEmail: null,
  ...fields,
});

const visitorMessage = (
  fields: Partial<NewContactMessage> = {},
): NewContactMessage => ({
  userId: null,
  kind: "help",
  body: "I cannot sign in",
  replyEmail: "visitor@example.test",
  ...fields,
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe("createContactMessage", () => {
  it("stores what a signed-in person wrote, and what a visitor wrote with an address", async () => {
    const ana = await newUser();

    expect(await createContactMessage(db, memberMessage(ana.id))).toBe("sent");
    expect(await createContactMessage(db, visitorMessage())).toBe("sent");

    const rows = await db.select().from(contactMessages);
    const mine = rows.find((row) => row.userId === ana.id);
    const theirs = rows.find((row) => row.userId === null);
    expect(mine).toMatchObject({
      kind: "problem",
      body: "The search is slow",
      replyEmail: null,
      status: "new",
      handledAt: null,
    });
    expect(theirs).toMatchObject({
      kind: "help",
      replyEmail: "visitor@example.test",
    });
  });

  it("tells each active administrator the kind, and never the text, the address or who wrote it", async () => {
    const admin = await newUser({ role: "admin" });
    const otherAdmin = await newUser({ role: "admin" });
    const gone = await newUser({ role: "admin" });
    await eraseAccount(db, gone.clerkId);
    const ana = await newUser();

    await createContactMessage(
      db,
      memberMessage(ana.id, { body: "secret text" }),
    );
    await createContactMessage(
      db,
      visitorMessage({ replyEmail: "hidden@example.test" }),
    );

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.userId))).toEqual(
      new Set([admin.id, otherAdmin.id]),
    );
    expect(rows.every((row) => row.type === "contact.created")).toBe(true);
    expect(
      rows
        .map((row) => row.payload)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual([
      { kind: "help" },
      { kind: "help" },
      { kind: "problem" },
      { kind: "problem" },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("secret text");
    expect(text).not.toContain("hidden@example.test");
    expect(text).not.toContain(ana.id);
  });

  it("works with no administrator at all", async () => {
    const ana = await newUser();

    expect(await createContactMessage(db, memberMessage(ana.id))).toBe("sent");
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("allows 5 a day to a signed-in person and refuses the next, apart from other people", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await newUser();

    for (let i = 0; i < dailyMemberCap; i++) {
      expect(await createContactMessage(db, memberMessage(ana.id))).toBe(
        "sent",
      );
    }
    expect(await createContactMessage(db, memberMessage(ana.id))).toBe("limit");

    expect(await createContactMessage(db, memberMessage(bob.id))).toBe("sent");
    expect(await createContactMessage(db, visitorMessage())).toBe("sent");
    expect(await db.select().from(contactMessages)).toHaveLength(7);
    // Nobody is told about the one that was refused.
    expect(
      (await db.select().from(notifications)).filter(
        (row) => row.userId === admin.id,
      ),
    ).toHaveLength(7);
  });

  it("allows 50 a day to the visitors together, and does not touch the signed-in", async () => {
    const ana = await newUser();
    await db.insert(contactMessages).values(
      Array.from({ length: dailyVisitorCap }, () => ({
        kind: "help",
        body: "from a visitor",
      })),
    );

    expect(await createContactMessage(db, visitorMessage())).toBe("limit");
    expect(await createContactMessage(db, memberMessage(ana.id))).toBe("sent");
    expect(await db.select().from(contactMessages)).toHaveLength(
      dailyVisitorCap + 1,
    );
  });

  it("does not count a message older than a day against the limit", async () => {
    const ana = await newUser();
    for (let i = 0; i < dailyMemberCap; i++) {
      await createContactMessage(db, memberMessage(ana.id));
    }
    await db
      .update(contactMessages)
      .set({ createdAt: daysAgo(2) })
      .where(eq(contactMessages.userId, ana.id));

    expect(await createContactMessage(db, memberMessage(ana.id))).toBe("sent");
  });
});

describe("listContactMessages", () => {
  it("lists the new ones first and then the handled, each newest first, with who wrote them", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    await db.insert(contactMessages).values([
      {
        userId: ana.id,
        kind: "feedback",
        body: "old new",
        createdAt: daysAgo(3),
      },
      { kind: "help", body: "visitor new", createdAt: daysAgo(1) },
      {
        userId: ana.id,
        kind: "problem",
        body: "handled newest",
        status: "handled",
        handledBy: admin.id,
        handledAt: new Date(),
        createdAt: daysAgo(0.5),
      },
    ]);

    const list = await listContactMessages(db);

    expect(list.map((message) => message.body)).toEqual([
      "visitor new",
      "old new",
      "handled newest",
    ]);
    expect(list[0]).toMatchObject({ username: null, status: "new" });
    expect(list[1]?.username).toBe(ana.username);
    expect(list[2]).toMatchObject({ status: "handled" });
    expect(list[2]?.handledAt).toBeInstanceOf(Date);
    expect(await listContactMessages(db, 2)).toHaveLength(2);
  });
});

describe("setContactMessageStatus and deleteContactMessage", () => {
  async function oneMessage() {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    await createContactMessage(
      db,
      memberMessage(ana.id, { body: "private words" }),
    );
    const [row] = await db.select().from(contactMessages);
    return { admin, ana, id: row?.id ?? "" };
  }

  it("marks it handled and new again, and audits each change with the kind and no text", async () => {
    const { admin, id } = await oneMessage();

    expect(await setContactMessageStatus(db, admin.id, id, "handled")).toBe(
      true,
    );
    const [handled] = await db.select().from(contactMessages);
    expect(handled).toMatchObject({ status: "handled", handledBy: admin.id });
    expect(handled?.handledAt).toBeInstanceOf(Date);

    expect(await setContactMessageStatus(db, admin.id, id, "new")).toBe(true);
    const [reopened] = await db.select().from(contactMessages);
    expect(reopened).toMatchObject({
      status: "new",
      handledBy: null,
      handledAt: null,
    });

    const audit = (await db.select().from(auditLog)).filter((row) =>
      row.action.startsWith("contact."),
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      "contact.handled",
      "contact.reopened",
    ]);
    expect(audit.every((row) => row.targetId === id)).toBe(true);
    expect(audit.every((row) => row.actorId === admin.id)).toBe(true);
    expect(audit[0]?.metadata).toEqual({ kind: "problem" });
    expect(JSON.stringify(audit)).not.toContain("private words");
  });

  it("says false, and audits nothing, when it is already in that state or does not exist", async () => {
    const { admin, id } = await oneMessage();

    expect(await setContactMessageStatus(db, admin.id, id, "new")).toBe(false);
    await setContactMessageStatus(db, admin.id, id, "handled");
    expect(await setContactMessageStatus(db, admin.id, id, "handled")).toBe(
      false,
    );
    expect(
      await setContactMessageStatus(
        db,
        admin.id,
        "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
        "handled",
      ),
    ).toBe(false);

    expect(
      (await db.select().from(auditLog)).filter((row) =>
        row.action.startsWith("contact."),
      ),
    ).toHaveLength(1);
  });

  it("deletes it and audits the kind and the id, never the text", async () => {
    const { admin, id } = await oneMessage();

    expect(await deleteContactMessage(db, admin.id, id)).toBe(true);

    expect(await db.select().from(contactMessages)).toHaveLength(0);
    const [audit] = (await db.select().from(auditLog)).filter(
      (row) => row.action === "contact.deleted",
    );
    expect(audit).toMatchObject({
      actorId: admin.id,
      targetType: "contact_message",
      targetId: id,
      metadata: { kind: "problem" },
    });
    expect(JSON.stringify(audit)).not.toContain("private words");
    expect(await deleteContactMessage(db, admin.id, id)).toBe(false);
  });
});

describe("pruneContactMessages", () => {
  it("deletes what is older than 90 days, handled or not, and keeps the rest", async () => {
    const ana = await newUser();
    await db.insert(contactMessages).values([
      {
        userId: ana.id,
        kind: "help",
        body: "old",
        createdAt: daysAgo(contactRetentionDays + 1),
      },
      {
        kind: "help",
        body: "old and handled",
        status: "handled",
        handledAt: new Date(),
        createdAt: daysAgo(contactRetentionDays + 5),
      },
      {
        userId: ana.id,
        kind: "help",
        body: "recent",
        createdAt: daysAgo(contactRetentionDays - 1),
      },
    ]);

    expect(await pruneContactMessages(db)).toBe(2);

    expect(
      (await db.select().from(contactMessages)).map((row) => row.body),
    ).toEqual(["recent"]);
    expect(await pruneContactMessages(db)).toBe(0);
  });
});

describe("the account erasure and the export", () => {
  it("erases the messages of the person with the account, and not a visitor's or somebody else's", async () => {
    const ana = await newUser();
    const bob = await newUser();
    await createContactMessage(db, memberMessage(ana.id, { body: "ana text" }));
    await createContactMessage(db, memberMessage(bob.id, { body: "bob text" }));
    await createContactMessage(db, visitorMessage({ body: "visitor text" }));

    await eraseAccount(db, ana.clerkId);

    expect(
      (await db.select().from(contactMessages)).map((row) => row.body).sort(),
    ).toEqual(["bob text", "visitor text"]);
  });

  it("exports the messages the person sent, and only theirs", async () => {
    const ana = await newUser();
    const bob = await newUser();
    await createContactMessage(
      db,
      memberMessage(ana.id, { kind: "feedback", body: "ana text" }),
    );
    await createContactMessage(db, memberMessage(bob.id, { body: "bob text" }));
    await createContactMessage(db, visitorMessage({ body: "visitor text" }));

    const data = await exportAccount(db, ana.id);

    expect(data?.contactMessages).toEqual([
      {
        kind: "feedback",
        body: "ana text",
        status: "new",
        createdAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("bob text");
    expect(JSON.stringify(data)).not.toContain("visitor text");
  });
});
