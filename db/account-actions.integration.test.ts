import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findReportedPerson,
  findRestrictedAccount,
  liftRestriction,
  listRestrictedAccounts,
  restrictAccount,
  warnPerson,
} from "../server/db/account-actions";
import { eraseAccount } from "../server/db/erase-user";
import { listOpenReports } from "../server/db/moderation";
import { findViewableProfile } from "../server/db/profile-lookup";
import { createReport, type NewReport } from "../server/db/reports";
import { auditLog, notifications, reports, users } from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

const photo = "https://img.clerk.com/photo-one";

const userReport = (
  reporterId: string,
  targetId: string,
  fields: Partial<NewReport> = {},
): NewReport => ({
  reporterId,
  targetId,
  kind: "user",
  reason: "spam",
  details: null,
  pictureUrl: null,
  ...fields,
});

const pictureReport = (
  reporterId: string,
  targetId: string,
  fields: Partial<NewReport> = {},
): NewReport => ({
  ...userReport(reporterId, targetId),
  kind: "picture",
  reason: "violent",
  pictureUrl: photo,
  ...fields,
});

const rowOf = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0];

/** The warnings only: a report also leaves an alert for the administrators. */
const warnings = () =>
  db
    .select()
    .from(notifications)
    .where(eq(notifications.type, "moderation.warning"));

const reportsNow = () =>
  db.select().from(reports).orderBy(reports.createdAt, reports.id);

/** An administrator, a reporter, a reported person with a picture, and the report of the person. */
async function scene(
  make: (reporterId: string, targetId: string) => NewReport = userReport,
  targetFields: Partial<typeof users.$inferInsert> = {},
) {
  const admin = await newUser({ role: "admin" });
  const ana = await newUser();
  const bob = await newUser({ avatarUrl: photo, ...targetFields });
  await createReport(db, make(ana.id, bob.id));
  const [report] = await reportsNow();
  return { admin, ana, bob, id: report?.id ?? "" };
}

describe("findReportedPerson", () => {
  it("finds the person of an open report, of a picture or of the person", async () => {
    const { admin, bob, id } = await scene();

    expect(await findReportedPerson(db, admin.id, id)).toEqual({
      reportId: id,
      userId: bob.id,
      clerkId: bob.clerkId,
      kind: "user",
      reason: "spam",
      state: "active",
      protected: false,
      pictureHidden: false,
    });
  });

  it("says when the person is an administrator, or is the one asking", async () => {
    const { admin, bob, id } = await scene();
    expect((await findReportedPerson(db, bob.id, id))?.protected).toBe(true);

    await db.update(users).set({ role: "admin" }).where(eq(users.id, bob.id));
    expect((await findReportedPerson(db, admin.id, id))?.protected).toBe(true);
  });

  it("says when the reported picture is hidden", async () => {
    const { admin, id } = await scene((a, b) =>
      pictureReport(a, b, { reason: "sexual_minors" }),
    );

    expect((await findReportedPerson(db, admin.id, id))?.pictureHidden).toBe(
      true,
    );
  });

  it("finds nothing for an answered or cancelled report, or an erased person", async () => {
    const { admin, bob, id } = await scene();
    await db.update(reports).set({ status: "dismissed" });
    expect(await findReportedPerson(db, admin.id, id)).toBeNull();

    await db.update(reports).set({ status: "open", cancelledAt: new Date() });
    expect(await findReportedPerson(db, admin.id, id)).toBeNull();

    await db.update(reports).set({ cancelledAt: null });
    await eraseAccount(db, bob.clerkId);
    expect(await findReportedPerson(db, admin.id, id)).toBeNull();
  });
});

describe("warnPerson", () => {
  it("tells the person with the kind and the reason, resolves the report and audits it", async () => {
    const { admin, ana, bob, id } = await scene();

    expect(await warnPerson(db, admin.id, id, "harassment")).toBe(true);

    const [note] = await warnings();
    expect(note).toMatchObject({
      userId: bob.id,
      type: "moderation.warning",
      payload: { kind: "user", reason: "harassment" },
      dedupeKey: `warning:${id}`,
      readAt: null,
    });
    // It says nothing of who reported, nor of the picture.
    // Exactly the kind and the reason: nothing that points to the report, the reporter or the picture.
    expect(note?.payload).toEqual({ kind: "user", reason: "harassment" });
    expect(JSON.stringify(note?.payload)).not.toContain(ana.id);
    expect(JSON.stringify(note?.payload)).not.toContain(photo);
    expect((await reportsNow())[0]).toMatchObject({
      status: "resolved",
      resolvedBy: admin.id,
    });
    expect((await db.select().from(auditLog))[0]).toMatchObject({
      actorId: admin.id,
      action: "account.warned",
      targetType: "user",
      targetId: bob.id,
      metadata: { reportId: id, reason: "harassment" },
    });
  });

  it("warns for a report of a picture that is not hidden", async () => {
    const { admin, bob, id } = await scene(pictureReport);

    expect(await warnPerson(db, admin.id, id, "violent")).toBe(true);

    expect((await warnings())[0]).toMatchObject({
      userId: bob.id,
      payload: { kind: "picture", reason: "violent" },
    });
  });

  it("refuses while the reported picture is hidden, and writes nothing", async () => {
    const { admin, id } = await scene((a, b) =>
      pictureReport(a, b, { reason: "sexual_minors" }),
    );

    expect(await warnPerson(db, admin.id, id, "sexual_minors")).toBe(false);

    expect(await warnings()).toHaveLength(0);
    expect((await reportsNow())[0]?.status).toBe("open");
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("refuses an administrator, oneself, a second time and an erased person", async () => {
    const { admin, bob, id } = await scene();
    expect(await warnPerson(db, bob.id, id, "spam")).toBe(false);

    await db.update(users).set({ role: "admin" }).where(eq(users.id, bob.id));
    expect(await warnPerson(db, admin.id, id, "spam")).toBe(false);
    await db.update(users).set({ role: "user" }).where(eq(users.id, bob.id));

    expect(await warnPerson(db, admin.id, id, "spam")).toBe(true);
    expect(await warnPerson(db, admin.id, id, "spam")).toBe(false);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });
});

describe("restrictAccount", () => {
  it("suspends: keeps the profile as it was, resolves the reports and audits it", async () => {
    const { admin, ana, bob, id } = await scene(userReport, {
      privacy: "friends",
    });
    await createReport(db, pictureReport(ana.id, bob.id));

    expect(await restrictAccount(db, admin.id, id, "suspended")).toBe(true);

    const row = await rowOf(bob.id);
    expect(row).toMatchObject({
      moderationStatus: "suspended",
      privacy: "friends",
      privacyBeforeBan: null,
    });
    expect(row?.moderationChangedAt).toBeInstanceOf(Date);
    expect((await reportsNow()).map((r) => r.status)).toEqual([
      "resolved",
      "resolved",
    ]);
    expect((await db.select().from(auditLog))[0]).toMatchObject({
      actorId: admin.id,
      action: "account.suspended",
      targetId: bob.id,
      metadata: { reportId: id, from: "active", reports: 2 },
    });
  });

  it("bans: puts the profile at private, keeps the level it had, and hides it", async () => {
    const { admin, bob, id } = await scene(userReport, { privacy: "public" });
    expect(await findViewableProfile(db, null, bob.username)).not.toBeNull();

    expect(await restrictAccount(db, admin.id, id, "banned")).toBe(true);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "banned",
      privacy: "private",
      privacyBeforeBan: "public",
    });
    expect(await findViewableProfile(db, null, bob.username)).toBeNull();
    expect((await db.select().from(auditLog))[0]).toMatchObject({
      action: "account.banned",
    });
  });

  it("bans a suspended account, which keeps the level it had before", async () => {
    const { admin, ana, bob, id } = await scene(userReport, {
      privacy: "friends",
    });
    await restrictAccount(db, admin.id, id, "suspended");
    await createReport(db, pictureReport(ana.id, bob.id));
    const second = (await reportsNow()).find((r) => r.status === "open");

    expect(
      await restrictAccount(db, admin.id, second?.id ?? "", "banned"),
    ).toBe(true);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "banned",
      privacy: "private",
      privacyBeforeBan: "friends",
    });
  });

  it("does not suspend an account that is suspended already, and leaves its report open", async () => {
    const { admin, ana, bob, id } = await scene();
    await restrictAccount(db, admin.id, id, "suspended");
    await createReport(db, pictureReport(ana.id, bob.id));
    const open = (await reportsNow()).find((r) => r.status === "open");

    expect(
      await restrictAccount(db, admin.id, open?.id ?? "", "suspended"),
    ).toBe(false);

    expect((await reportsNow()).find((r) => r.id === open?.id)?.status).toBe(
      "open",
    );
    expect(
      (await db.select().from(auditLog)).filter(
        (row) => row.action === "account.suspended",
      ),
    ).toHaveLength(1);
  });

  it("does not suspend a banned account, nor ban a banned one", async () => {
    const { admin, ana, bob, id } = await scene();
    await restrictAccount(db, admin.id, id, "banned");
    await createReport(db, pictureReport(ana.id, bob.id));
    const open = (await reportsNow()).find((r) => r.status === "open");

    expect(
      await restrictAccount(db, admin.id, open?.id ?? "", "suspended"),
    ).toBe(false);
    expect(await restrictAccount(db, admin.id, open?.id ?? "", "banned")).toBe(
      false,
    );
    expect(await rowOf(bob.id)).toMatchObject({ privacyBeforeBan: "public" });
  });

  it("leaves a report of a hidden picture open, to be restored or removed", async () => {
    const { admin, ana, bob, id } = await scene((a, b) =>
      pictureReport(a, b, { reason: "sexual_minors" }),
    );
    await createReport(db, userReport(ana.id, bob.id));

    expect(await restrictAccount(db, admin.id, id, "banned")).toBe(true);

    const rows = await reportsNow();
    expect(rows.find((r) => r.id === id)?.status).toBe("open");
    expect(rows.find((r) => r.targetType === "user")?.status).toBe("resolved");
    expect((await rowOf(bob.id))?.hiddenAvatarUrl).toBe(photo);
    expect((await db.select().from(auditLog))[0]?.metadata).toMatchObject({
      reports: 1,
    });
  });

  it("refuses an administrator and oneself, and changes nothing", async () => {
    const { admin, bob, id } = await scene();
    expect(await restrictAccount(db, bob.id, id, "banned")).toBe(false);

    await db.update(users).set({ role: "admin" }).where(eq(users.id, bob.id));
    expect(await restrictAccount(db, admin.id, id, "suspended")).toBe(false);

    expect(await rowOf(bob.id)).toMatchObject({ moderationStatus: "active" });
    expect((await reportsNow())[0]?.status).toBe("open");
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("refuses a report that is not open", async () => {
    const { admin, id } = await scene();
    await db.update(reports).set({ status: "dismissed" });

    expect(await restrictAccount(db, admin.id, id, "banned")).toBe(false);
  });

  it("accepts only the three states the table knows", async () => {
    const ana = await newUser();

    expect(
      await failsWith(
        db
          .update(users)
          .set({ moderationStatus: "exiled" })
          .where(eq(users.id, ana.id)),
      ),
    ).toEqual({ code: "23514", constraint: "users_moderation_status_check" });
  });
});

describe("erasing a banned account", () => {
  it("forgets the level kept for the ban and keeps the state of the account", async () => {
    const { admin, bob, id } = await scene(userReport, { privacy: "public" });
    await restrictAccount(db, admin.id, id, "banned");

    await eraseAccount(db, bob.clerkId);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "banned",
      privacyBeforeBan: null,
      privacy: "private",
    });
  });
});

describe("lifting", () => {
  it("lifts a suspension and a ban, gives the profile its level and audits it", async () => {
    const { admin, ana, bob, id } = await scene(userReport, {
      privacy: "friends",
    });
    await restrictAccount(db, admin.id, id, "banned");
    expect(await findRestrictedAccount(db, bob.id)).toEqual({
      clerkId: bob.clerkId,
      state: "banned",
    });

    expect(await liftRestriction(db, admin.id, bob.id)).toBe(true);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "active",
      privacy: "friends",
      privacyBeforeBan: null,
    });
    const lifted = (await db.select().from(auditLog)).find(
      (row) => row.action === "account.lifted",
    );
    expect(lifted).toMatchObject({
      actorId: admin.id,
      targetId: bob.id,
      metadata: { from: "banned" },
    });

    await createReport(db, pictureReport(ana.id, bob.id));
    const open = (await reportsNow()).find((r) => r.status === "open");
    await restrictAccount(db, admin.id, open?.id ?? "", "suspended");
    expect(await liftRestriction(db, admin.id, bob.id)).toBe(true);
    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "active",
      privacy: "friends",
    });
  });

  it("does not change the level the person chose after a suspension", async () => {
    const { admin, bob, id } = await scene(userReport, { privacy: "public" });
    await restrictAccount(db, admin.id, id, "suspended");
    await db
      .update(users)
      .set({ privacy: "friends" })
      .where(eq(users.id, bob.id));

    await liftRestriction(db, admin.id, bob.id);

    expect((await rowOf(bob.id))?.privacy).toBe("friends");
  });

  it("refuses an active account, an erased one and a second time", async () => {
    const { admin, bob, id } = await scene();
    expect(await liftRestriction(db, admin.id, bob.id)).toBe(false);
    expect(await findRestrictedAccount(db, bob.id)).toBeNull();

    await restrictAccount(db, admin.id, id, "suspended");
    expect(await liftRestriction(db, admin.id, bob.id)).toBe(true);
    expect(await liftRestriction(db, admin.id, bob.id)).toBe(false);

    await db
      .update(users)
      .set({ moderationStatus: "banned" })
      .where(eq(users.id, bob.id));
    await eraseAccount(db, bob.clerkId);
    expect(await liftRestriction(db, admin.id, bob.id)).toBe(false);
  });
});

describe("listRestrictedAccounts and the queue", () => {
  it("lists suspended and banned accounts, the latest first, and not the erased", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await newUser();
    const carl = await newUser();
    const dana = await newUser();
    await db.update(users).set({ moderationStatus: "active" });
    for (const [person, status, at] of [
      [ana, "suspended", "2026-11-01"],
      [bob, "banned", "2026-11-02"],
      [carl, "banned", "2026-11-03"],
    ] as const) {
      await db
        .update(users)
        .set({ moderationStatus: status, moderationChangedAt: new Date(at) })
        .where(eq(users.id, person.id));
    }
    await eraseAccount(db, carl.clerkId);

    const list = await listRestrictedAccounts(db, 50);

    expect(list.map((a) => [a.username, a.state])).toEqual([
      [bob.username, "banned"],
      [ana.username, "suspended"],
    ]);
    expect(list[0]).toMatchObject({ id: bob.id, clerkId: bob.clerkId });
    expect(list.some((a) => a.id === dana.id || a.id === admin.id)).toBe(false);
  });

  it("shows the state of the account in the queue, and who is protected", async () => {
    const { admin, ana, bob, id } = await scene(pictureReport);
    await createReport(db, userReport(admin.id, ana.id));

    const queue = await listOpenReports(db, admin.id);

    expect(queue.find((r) => r.id === id)).toMatchObject({
      account: "active",
      protected: false,
    });
    // Anyone's report about an administrator is protected too.
    await db.update(users).set({ role: "admin" }).where(eq(users.id, bob.id));
    expect(
      (await listOpenReports(db, admin.id)).find((r) => r.id === id)?.protected,
    ).toBe(true);
  });
});
