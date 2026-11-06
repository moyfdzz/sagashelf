import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findPersonByUsername,
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

    expect(await warnPerson(db, admin.id, { reportId: id }, "harassment")).toBe(
      true,
    );

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

    expect(await warnPerson(db, admin.id, { reportId: id }, "violent")).toBe(
      true,
    );

    expect((await warnings())[0]).toMatchObject({
      userId: bob.id,
      payload: { kind: "picture", reason: "violent" },
    });
  });

  it("refuses while the reported picture is hidden, and writes nothing", async () => {
    const { admin, id } = await scene((a, b) =>
      pictureReport(a, b, { reason: "sexual_minors" }),
    );

    expect(
      await warnPerson(db, admin.id, { reportId: id }, "sexual_minors"),
    ).toBe(false);

    expect(await warnings()).toHaveLength(0);
    expect((await reportsNow())[0]?.status).toBe("open");
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("refuses an administrator, oneself, a second time and an erased person", async () => {
    const { admin, bob, id } = await scene();
    expect(await warnPerson(db, bob.id, { reportId: id }, "spam")).toBe(false);

    await db.update(users).set({ role: "admin" }).where(eq(users.id, bob.id));
    expect(await warnPerson(db, admin.id, { reportId: id }, "spam")).toBe(
      false,
    );
    await db.update(users).set({ role: "user" }).where(eq(users.id, bob.id));

    expect(await warnPerson(db, admin.id, { reportId: id }, "spam")).toBe(true);
    expect(await warnPerson(db, admin.id, { reportId: id }, "spam")).toBe(
      false,
    );
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });
});

describe("restrictAccount", () => {
  it("suspends: keeps the profile as it was, resolves the reports and audits it", async () => {
    const { admin, ana, bob, id } = await scene(userReport, {
      privacy: "friends",
    });
    await createReport(db, pictureReport(ana.id, bob.id));

    expect(
      await restrictAccount(db, admin.id, { reportId: id }, "suspended"),
    ).toBe(true);

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

    expect(
      await restrictAccount(db, admin.id, { reportId: id }, "banned"),
    ).toBe(true);

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
    await restrictAccount(db, admin.id, { reportId: id }, "suspended");
    await createReport(db, pictureReport(ana.id, bob.id));
    const second = (await reportsNow()).find((r) => r.status === "open");

    expect(
      await restrictAccount(
        db,
        admin.id,
        { reportId: second?.id ?? "" },
        "banned",
      ),
    ).toBe(true);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "banned",
      privacy: "private",
      privacyBeforeBan: "friends",
    });
  });

  it("does not suspend an account that is suspended already, and leaves its report open", async () => {
    const { admin, ana, bob, id } = await scene();
    await restrictAccount(db, admin.id, { reportId: id }, "suspended");
    await createReport(db, pictureReport(ana.id, bob.id));
    const open = (await reportsNow()).find((r) => r.status === "open");

    expect(
      await restrictAccount(
        db,
        admin.id,
        { reportId: open?.id ?? "" },
        "suspended",
      ),
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
    await restrictAccount(db, admin.id, { reportId: id }, "banned");
    await createReport(db, pictureReport(ana.id, bob.id));
    const open = (await reportsNow()).find((r) => r.status === "open");

    expect(
      await restrictAccount(
        db,
        admin.id,
        { reportId: open?.id ?? "" },
        "suspended",
      ),
    ).toBe(false);
    expect(
      await restrictAccount(
        db,
        admin.id,
        { reportId: open?.id ?? "" },
        "banned",
      ),
    ).toBe(false);
    expect(await rowOf(bob.id)).toMatchObject({ privacyBeforeBan: "public" });
  });

  it("leaves a report of a hidden picture open, to be restored or removed", async () => {
    const { admin, ana, bob, id } = await scene((a, b) =>
      pictureReport(a, b, { reason: "sexual_minors" }),
    );
    await createReport(db, userReport(ana.id, bob.id));

    expect(
      await restrictAccount(db, admin.id, { reportId: id }, "banned"),
    ).toBe(true);

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
    expect(await restrictAccount(db, bob.id, { reportId: id }, "banned")).toBe(
      false,
    );

    await db.update(users).set({ role: "admin" }).where(eq(users.id, bob.id));
    expect(
      await restrictAccount(db, admin.id, { reportId: id }, "suspended"),
    ).toBe(false);

    expect(await rowOf(bob.id)).toMatchObject({ moderationStatus: "active" });
    expect((await reportsNow())[0]?.status).toBe("open");
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("refuses a report that is not open", async () => {
    const { admin, id } = await scene();
    await db.update(reports).set({ status: "dismissed" });

    expect(
      await restrictAccount(db, admin.id, { reportId: id }, "banned"),
    ).toBe(false);
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
    await restrictAccount(db, admin.id, { reportId: id }, "banned");

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
    await restrictAccount(db, admin.id, { reportId: id }, "banned");
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
    await restrictAccount(
      db,
      admin.id,
      { reportId: open?.id ?? "" },
      "suspended",
    );
    expect(await liftRestriction(db, admin.id, bob.id)).toBe(true);
    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "active",
      privacy: "friends",
    });
  });

  it("does not change the level the person chose after a suspension", async () => {
    const { admin, bob, id } = await scene(userReport, { privacy: "public" });
    await restrictAccount(db, admin.id, { reportId: id }, "suspended");
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

    await restrictAccount(db, admin.id, { reportId: id }, "suspended");
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

describe("findPersonByUsername (SAG-146)", () => {
  it("finds a person by username whatever their privacy, with the state of the account", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser({ privacy: "private", displayName: "Bob" });

    expect(await findPersonByUsername(db, admin.id, bob.username)).toEqual({
      userId: bob.id,
      clerkId: bob.clerkId,
      username: bob.username,
      displayName: "Bob",
      state: "active",
      protected: false,
    });
  });

  it("says when the person is an administrator, or is the one asking", async () => {
    const admin = await newUser({ role: "admin" });
    const other = await newUser({ role: "admin" });

    expect(
      (await findPersonByUsername(db, admin.id, other.username))?.protected,
    ).toBe(true);
    expect(
      (await findPersonByUsername(db, admin.id, admin.username))?.protected,
    ).toBe(true);
  });

  it("does not tell the case of the name apart, and finds nothing for an erased account or a name that does not exist", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser({ username: "Bob_Reads" });

    expect(
      await findPersonByUsername(db, admin.id, "bob_reads"),
    ).not.toBeNull();
    expect(await findPersonByUsername(db, admin.id, "nobody_here")).toBeNull();
    await eraseAccount(db, bob.clerkId);
    expect(await findPersonByUsername(db, admin.id, "Bob_Reads")).toBeNull();
  });

  it("shows the state of a suspended or banned account", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser({ moderationStatus: "banned" });

    expect(
      (await findPersonByUsername(db, admin.id, bob.username))?.state,
    ).toBe("banned");
  });
});

describe("warning a person with no report (SAG-146)", () => {
  it("sends the warning as about the person, with the reason and nothing else, and audits it as direct with the note", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser();

    expect(
      await warnPerson(
        db,
        admin.id,
        { userId: bob.id },
        "harassment",
        "saw it in a list",
      ),
    ).toBe(true);

    const [note] = await warnings();
    expect(note).toMatchObject({ userId: bob.id, type: "moderation.warning" });
    expect(note?.payload).toEqual({ kind: "user", reason: "harassment" });
    expect(note?.dedupeKey).toMatch(/^warning:[0-9a-f-]{36}$/);
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      actorId: admin.id,
      action: "account.warned",
      targetType: "user",
      targetId: bob.id,
      metadata: {
        direct: true,
        reason: "harassment",
        note: "saw it in a list",
      },
    });
    // No report is involved, and the note never reaches the person.
    expect(entry?.metadata).not.toHaveProperty("reportId");
    expect(JSON.stringify(note)).not.toContain("saw it in a list");
  });

  it("can warn the same person again, which a report cannot", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser();

    expect(await warnPerson(db, admin.id, { userId: bob.id }, "spam")).toBe(
      true,
    );
    expect(await warnPerson(db, admin.id, { userId: bob.id }, "spam")).toBe(
      true,
    );

    expect(await warnings()).toHaveLength(2);
  });

  it("leaves the reports of the person open, and leaves out the note when there is none", async () => {
    const { admin, bob } = await scene();

    await warnPerson(db, admin.id, { userId: bob.id }, "spam");

    expect((await reportsNow())[0]?.status).toBe("open");
    const [entry] = await db.select().from(auditLog);
    expect(entry?.metadata).not.toHaveProperty("note");
  });

  it("refuses an administrator, oneself and an erased account", async () => {
    const admin = await newUser({ role: "admin" });
    const other = await newUser({ role: "admin" });
    const bob = await newUser();
    await eraseAccount(db, bob.clerkId);

    for (const id of [admin.id, other.id, bob.id]) {
      expect(await warnPerson(db, admin.id, { userId: id }, "spam")).toBe(
        false,
      );
    }
    expect(await warnings()).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("refuses an id that is not a person", async () => {
    const admin = await newUser({ role: "admin" });

    expect(
      await warnPerson(
        db,
        admin.id,
        { userId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f" },
        "spam",
      ),
    ).toBe(false);
  });
});

describe("suspending and banning a person with no report (SAG-146)", () => {
  it("suspends: keeps the profile, audits it as direct with the note and closes the open reports about the person", async () => {
    const { admin, ana, bob } = await scene(userReport, { privacy: "friends" });
    await createReport(db, pictureReport(ana.id, bob.id));

    expect(
      await restrictAccount(
        db,
        admin.id,
        { userId: bob.id },
        "suspended",
        "ignored a warning",
      ),
    ).toBe(true);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "suspended",
      privacy: "friends",
    });
    expect((await reportsNow()).map((r) => r.status)).toEqual([
      "resolved",
      "resolved",
    ]);
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      action: "account.suspended",
      targetId: bob.id,
      metadata: {
        direct: true,
        from: "active",
        reports: 2,
        note: "ignored a warning",
      },
    });
    expect(entry?.metadata).not.toHaveProperty("reportId");
  });

  it("bans: hides the profile with the level it had, and gives it back on lifting", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser({ privacy: "public" });

    expect(
      await restrictAccount(db, admin.id, { userId: bob.id }, "banned"),
    ).toBe(true);

    expect(await rowOf(bob.id)).toMatchObject({
      moderationStatus: "banned",
      privacy: "private",
      privacyBeforeBan: "public",
    });
    expect(await findViewableProfile(db, null, bob.username)).toBeNull();
    await liftRestriction(db, admin.id, bob.id);
    expect(await findViewableProfile(db, null, bob.username)).not.toBeNull();
  });

  it("bans a suspended account, and refuses to suspend or ban what is already restricted", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser({ privacy: "friends" });
    await restrictAccount(db, admin.id, { userId: bob.id }, "suspended");

    expect(
      await restrictAccount(db, admin.id, { userId: bob.id }, "suspended"),
    ).toBe(false);
    expect(
      await restrictAccount(db, admin.id, { userId: bob.id }, "banned"),
    ).toBe(true);
    expect(await rowOf(bob.id)).toMatchObject({ privacyBeforeBan: "friends" });
    expect(
      await restrictAccount(db, admin.id, { userId: bob.id }, "banned"),
    ).toBe(false);
  });

  it("leaves a report of a hidden picture open, as with a report", async () => {
    const { admin, ana, bob, id } = await scene((a, b) =>
      pictureReport(a, b, { reason: "sexual_minors" }),
    );
    await createReport(db, userReport(ana.id, bob.id));

    await restrictAccount(db, admin.id, { userId: bob.id }, "banned");

    const rows = await reportsNow();
    expect(rows.find((r) => r.id === id)?.status).toBe("open");
    expect(rows.find((r) => r.targetType === "user")?.status).toBe("resolved");
  });

  it("refuses an administrator, oneself and an erased account, and changes nothing", async () => {
    const admin = await newUser({ role: "admin" });
    const other = await newUser({ role: "admin" });
    const bob = await newUser();
    await eraseAccount(db, bob.clerkId);

    for (const id of [admin.id, other.id, bob.id]) {
      expect(
        await restrictAccount(db, admin.id, { userId: id }, "banned"),
      ).toBe(false);
    }
    expect(await rowOf(other.id)).toMatchObject({ moderationStatus: "active" });
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});

describe("the guards that do not depend on the role (SAG-146)", () => {
  // The data layer does not know that its caller is an administrator, so each guard stands alone.
  it("does not act on the person who asks, even if they were not an administrator", async () => {
    const ana = await newUser();

    expect(await warnPerson(db, ana.id, { userId: ana.id }, "spam")).toBe(
      false,
    );
    expect(
      await restrictAccount(db, ana.id, { userId: ana.id }, "suspended"),
    ).toBe(false);
    expect(await rowOf(ana.id)).toMatchObject({ moderationStatus: "active" });
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("says a person is protected when they are the one who asks, even if they were not an administrator", async () => {
    const ana = await newUser();

    expect(
      (await findPersonByUsername(db, ana.id, ana.username))?.protected,
    ).toBe(true);
  });

  it("finds nothing for an account that is marked as erased, whatever its username", async () => {
    const admin = await newUser({ role: "admin" });
    const bob = await newUser();
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, bob.id));

    expect(await findPersonByUsername(db, admin.id, bob.username)).toBeNull();
  });
});
