import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { applyAvatar } from "../server/db/avatar";
import { applyClerkOperation } from "../server/db/clerk-sync";
import { eraseAccount } from "../server/db/erase-user";
import {
  dismissReport,
  findPictureReport,
  listOpenReports,
  listSuspiciousUploads,
  recordPictureRemoved,
  restorePicture,
} from "../server/db/moderation";
import { recordPictureUpload } from "../server/db/picture-uploads";
import { createReport, type NewReport } from "../server/db/reports";
import { auditLog, reports, users } from "../server/db/schema";
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

const photo = "https://img.clerk.com/photo-one";
const newer = "https://img.clerk.com/photo-two";

async function withPicture(url: string | null = photo) {
  const person = await newUser();
  await db.update(users).set({ avatarUrl: url }).where(eq(users.id, person.id));
  return person;
}

const pictureReport = (
  reporterId: string,
  targetId: string,
  fields: Partial<NewReport> = {},
): NewReport => ({
  reporterId,
  targetId,
  kind: "picture",
  reason: "violent",
  details: null,
  pictureUrl: photo,
  ...fields,
});

const minors = (reporterId: string, targetId: string) =>
  pictureReport(reporterId, targetId, { reason: "sexual_minors" });

const rowOf = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0];

const reportsNow = () =>
  db.select().from(reports).orderBy(reports.createdAt, reports.id);

/** A `user.updated` of Clerk for this person, at a time later than anything stored. */
const userUpdated = (
  person: { clerkId: string; username: string },
  avatarUrl: string,
  updatedAt = new Date(Date.now() + 60_000),
) =>
  applyClerkOperation(db, `evt_${Math.random()}`, {
    kind: "upsert",
    user: {
      clerkId: person.clerkId,
      username: person.username,
      displayName: null,
      avatarUrl,
      hasOwnPicture: true,
      emailCanonical: `${person.clerkId}@example.test`,
      locale: "es",
      at: updatedAt,
    },
  });

describe("a hidden picture and the events of Clerk", () => {
  it("stays hidden when Clerk sends the same address again", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));

    expect(await userUpdated(bob, photo)).toBe("applied");

    const row = await rowOf(bob.id);
    expect(row?.avatarUrl).toBeNull();
    expect(row?.hiddenAvatarUrl).toBe(photo);
  });

  it("stays hidden when the picture is written by the settings page", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));

    await applyAvatar(db, bob.id, photo, true, new Date(Date.now() + 60_000));

    expect((await rowOf(bob.id))?.avatarUrl).toBeNull();
  });

  it("shows a new picture, and keeps the old address on record", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));

    await userUpdated(bob, newer);

    const row = await rowOf(bob.id);
    expect(row?.avatarUrl).toBe(newer);
    expect(row?.hiddenAvatarUrl).toBe(photo);
  });

  it("does not hide anything for a report that does not hide", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));

    await userUpdated(bob, photo);

    const row = await rowOf(bob.id);
    expect(row?.avatarUrl).toBe(photo);
    expect(row?.hiddenAvatarUrl).toBeNull();
  });

  it("forgets the hidden address when the account is erased", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));

    await eraseAccount(db, bob.clerkId);

    expect((await rowOf(bob.id))?.hiddenAvatarUrl).toBeNull();
  });
});

describe("listOpenReports", () => {
  it("lists minors first, then the oldest, with no reporter", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    const carl = await withPicture("https://img.clerk.com/carl");
    await createReport(db, pictureReport(ana.id, bob.id));
    await createReport(db, {
      ...minors(ana.id, carl.id),
      pictureUrl: "https://img.clerk.com/carl",
    });

    const queue = await listOpenReports(db, admin.id);

    expect(queue.map((r) => r.reason)).toEqual(["sexual_minors", "violent"]);
    expect(queue[0]).toMatchObject({
      kind: "picture",
      username: carl.username,
      hidden: true,
      current: true,
      sensitive: true,
      account: "active",
      protected: false,
    });
    expect(queue[1]).toMatchObject({ hidden: false, sensitive: false });
    expect(JSON.stringify(queue)).not.toContain(ana.username);
    expect(JSON.stringify(queue)).not.toContain(ana.id);
  });

  it("leaves out cancelled, dismissed and resolved reports", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    await createReport(db, {
      ...pictureReport(ana.id, bob.id),
      kind: "user",
      reason: "spam",
      pictureUrl: null,
    });
    const [first] = await reportsNow();
    await db
      .update(reports)
      .set({ status: "dismissed" })
      .where(eq(reports.id, first?.id ?? ""));
    expect(await listOpenReports(db, admin.id)).toHaveLength(1);

    await db.update(reports).set({ cancelledAt: new Date() });
    expect(await listOpenReports(db, admin.id)).toHaveLength(0);
  });

  it("says a report of an old picture is not current", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    await db
      .update(users)
      .set({ avatarUrl: newer })
      .where(eq(users.id, bob.id));

    const [item] = await listOpenReports(db, admin.id);

    expect(item?.current).toBe(false);
  });
});

describe("dismissReport", () => {
  it("closes the report and writes the audit entry with the administrator", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    const [report] = await reportsNow();

    expect(await dismissReport(db, admin.id, report?.id ?? "")).toBe(true);

    const [after] = await reportsNow();
    expect(after).toMatchObject({ status: "dismissed", resolvedBy: admin.id });
    expect(after?.resolvedAt).toBeInstanceOf(Date);
    const log = await db.select().from(auditLog);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorId: admin.id,
      action: "report.dismissed",
      targetType: "report",
      targetId: report?.id,
      metadata: { kind: "picture", reason: "violent" },
    });
  });

  it("refuses a second answer, and writes nothing more", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    const [report] = await reportsNow();
    await dismissReport(db, admin.id, report?.id ?? "");

    expect(await dismissReport(db, admin.id, report?.id ?? "")).toBe(false);

    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it("refuses a report whose picture is hidden, which must be restored or removed", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    const [report] = await reportsNow();

    expect(await dismissReport(db, admin.id, report?.id ?? "")).toBe(false);

    expect((await reportsNow())[0]?.status).toBe("open");
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("dismisses a report of a person", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await newUser();
    await createReport(db, {
      reporterId: ana.id,
      targetId: bob.id,
      kind: "user",
      reason: "spam",
      details: null,
      pictureUrl: null,
    });
    const [report] = await reportsNow();

    expect(await dismissReport(db, admin.id, report?.id ?? "")).toBe(true);
  });

  it("refuses a cancelled report and one that does not exist", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    await db.update(reports).set({ cancelledAt: new Date() });
    const [report] = await reportsNow();

    expect(await dismissReport(db, admin.id, report?.id ?? "")).toBe(false);
    expect(
      await dismissReport(db, admin.id, "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    ).toBe(false);
  });
});

describe("restorePicture", () => {
  it("shows the picture again, closes both reports and audits it once", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const carl = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    await createReport(db, pictureReport(carl.id, bob.id));
    const [report] = await reportsNow();

    expect(await restorePicture(db, admin.id, report?.id ?? "")).toBe(true);

    const row = await rowOf(bob.id);
    expect(row?.avatarUrl).toBe(photo);
    expect(row?.hiddenAvatarUrl).toBeNull();
    expect((await reportsNow()).map((r) => r.status)).toEqual([
      "dismissed",
      "dismissed",
    ]);
    const log = await db.select().from(auditLog);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorId: admin.id,
      action: "picture.restored",
      targetType: "user",
      targetId: bob.id,
      metadata: { reportId: report?.id, reports: 2 },
    });
  });

  it("survives a later user.updated from Clerk", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    const [report] = await reportsNow();
    await restorePicture(db, admin.id, report?.id ?? "");

    await userUpdated(bob, photo);

    expect((await rowOf(bob.id))?.avatarUrl).toBe(photo);
  });

  it("does not replace a newer picture", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    await userUpdated(bob, newer);
    const [report] = await reportsNow();

    await restorePicture(db, admin.id, report?.id ?? "");

    const row = await rowOf(bob.id);
    expect(row?.avatarUrl).toBe(newer);
    expect(row?.hiddenAvatarUrl).toBeNull();
  });

  it("refuses a picture that was never hidden, and a second time", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    const [visible] = await reportsNow();

    expect(await restorePicture(db, admin.id, visible?.id ?? "")).toBe(false);

    const carl = await withPicture("https://img.clerk.com/carl");
    await createReport(db, {
      ...minors(ana.id, carl.id),
      pictureUrl: "https://img.clerk.com/carl",
    });
    const hidden = (await reportsNow()).find((r) => r.targetId === carl.id);
    expect(await restorePicture(db, admin.id, hidden?.id ?? "")).toBe(true);
    expect(await restorePicture(db, admin.id, hidden?.id ?? "")).toBe(false);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });
});

describe("recordPictureRemoved", () => {
  const generated = "https://img.clerk.com/generated";
  const change = {
    avatarUrl: generated,
    hasOwnPicture: false,
    updatedAt: new Date(Date.now() + 60_000),
  };

  it("gives the generated image, forgets the hidden one and resolves the reports", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    const [report] = await reportsNow();

    expect(
      await recordPictureRemoved(db, admin.id, report?.id ?? "", change),
    ).toBe(true);

    const row = await rowOf(bob.id);
    expect(row).toMatchObject({
      avatarUrl: generated,
      hasOwnPicture: false,
      hiddenAvatarUrl: null,
    });
    expect((await reportsNow())[0]).toMatchObject({
      status: "resolved",
      resolvedBy: admin.id,
    });
    expect((await db.select().from(auditLog))[0]).toMatchObject({
      actorId: admin.id,
      action: "picture.removed",
      targetId: bob.id,
    });
  });

  it("does not overwrite a newer event of Clerk, but still forgets the hidden address", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    await userUpdated(bob, newer, new Date(Date.now() + 3_600_000));
    const [report] = await reportsNow();

    await recordPictureRemoved(db, admin.id, report?.id ?? "", change);

    const row = await rowOf(bob.id);
    expect(row?.avatarUrl).toBe(newer);
    expect(row?.hiddenAvatarUrl).toBeNull();
  });

  it("answers nothing for a report already answered", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));
    const [report] = await reportsNow();
    await recordPictureRemoved(db, admin.id, report?.id ?? "", change);

    expect(
      await recordPictureRemoved(db, admin.id, report?.id ?? "", change),
    ).toBe(false);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });
});

describe("findPictureReport", () => {
  it("finds an open report of a picture with the Clerk id, and says if it is current", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    const [report] = await reportsNow();

    expect(await findPictureReport(db, report?.id ?? "")).toEqual({
      id: report?.id,
      clerkId: bob.clerkId,
      current: true,
    });

    await userUpdated(bob, newer);
    expect((await findPictureReport(db, report?.id ?? ""))?.current).toBe(true);
    await db
      .update(users)
      .set({ hiddenAvatarUrl: null })
      .where(eq(users.id, bob.id));
    expect((await findPictureReport(db, report?.id ?? ""))?.current).toBe(
      false,
    );
  });

  it("finds nothing for a report of a person, an answered one or an erased account", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    const carl = await withPicture("https://img.clerk.com/carl");
    await createReport(db, {
      reporterId: ana.id,
      targetId: bob.id,
      kind: "user",
      reason: "spam",
      details: null,
      pictureUrl: null,
    });
    await createReport(db, {
      ...pictureReport(ana.id, carl.id),
      pictureUrl: "https://img.clerk.com/carl",
    });
    const all = await reportsNow();
    const ofPerson = all.find((r) => r.targetType === "user");
    const ofPicture = all.find((r) => r.targetType === "picture");

    expect(await findPictureReport(db, ofPerson?.id ?? "")).toBeNull();
    expect(await findPictureReport(db, ofPicture?.id ?? "")).not.toBeNull();
    await eraseAccount(db, carl.clerkId);
    expect(await findPictureReport(db, ofPicture?.id ?? "")).toBeNull();
  });
});

describe("listSuspiciousUploads", () => {
  const record = (
    userId: string,
    result: "allowed" | "rejected" | "unavailable",
    scores: Record<string, number> | null,
  ) =>
    recordPictureUpload(db, {
      userId,
      sha256: "abc",
      result,
      scores,
      ipAddress: "203.0.113.7",
    });

  it("lists the refused and the allowed ones close to the limit, and nothing else", async () => {
    const ana = await newUser();
    await record(ana.id, "rejected", { erotica: 0.9, very_suggestive: 0.1 });
    await record(ana.id, "allowed", { erotica: 0.4, very_suggestive: 0.1 });
    await record(ana.id, "allowed", { erotica: 0.05 });
    await record(ana.id, "unavailable", null);

    const list = await listSuspiciousUploads(db);

    expect(list.map((u) => [u.result, u.score]).sort()).toEqual([
      ["allowed", 0.4],
      ["rejected", 0.9],
    ]);
    expect(list[0]?.username).toBe(ana.username);
    expect(JSON.stringify(list)).not.toContain("203.0.113.7");
  });

  it("takes a score of exactly 0.3 as close, and 0.29 as not", async () => {
    const ana = await newUser();
    await record(ana.id, "allowed", { erotica: 0.3 });
    await record(ana.id, "allowed", { erotica: 0.29 });

    expect((await listSuspiciousUploads(db)).map((u) => u.score)).toEqual([
      0.3,
    ]);
  });
});
