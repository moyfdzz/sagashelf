import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import { eraseAccount } from "../server/db/erase-user";
import { dismissReport } from "../server/db/moderation";
import {
  prunePictureUploads,
  recordPictureUpload,
  sha256Hex,
} from "../server/db/picture-uploads";
import {
  cancelReport,
  createReport,
  dailyReportCap,
  findMyReports,
  type NewReport,
} from "../server/db/reports";
import {
  notifications,
  pictureUploads,
  reports,
  users,
} from "../server/db/schema";
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

const userReport = (reporterId: string, targetId: string): NewReport => ({
  reporterId,
  targetId,
  kind: "user",
  reason: "spam",
  details: null,
  pictureUrl: null,
});

const avatarOf = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0]?.avatarUrl;

describe("createReport", () => {
  it("records what was said, with the picture at that moment", async () => {
    const ana = await newUser();
    const bob = await withPicture();

    expect(
      await createReport(
        db,
        pictureReport(ana.id, bob.id, { details: "look at it" }),
      ),
    ).toBe("reported");

    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({
      reporterId: ana.id,
      targetType: "picture",
      targetId: bob.id,
      reason: "violent",
      details: "look at it",
      pictureUrl: photo,
      status: "open",
      cancelledAt: null,
    });
  });

  it("says duplicate for the same thing twice, and writes one row", async () => {
    const ana = await newUser();
    const bob = await withPicture();

    await createReport(db, userReport(ana.id, bob.id));
    expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
      "duplicate",
    );
    await createReport(db, pictureReport(ana.id, bob.id));
    expect(await createReport(db, pictureReport(ana.id, bob.id))).toBe(
      "duplicate",
    );

    expect(await db.select().from(reports)).toHaveLength(2);
  });

  it("keeps a picture and the person apart, and each picture apart", async () => {
    const ana = await newUser();
    const bob = await withPicture();

    expect(await createReport(db, pictureReport(ana.id, bob.id))).toBe(
      "reported",
    );
    expect(await createReport(db, userReport(ana.id, bob.id))).toBe("reported");
    expect(
      await createReport(
        db,
        pictureReport(ana.id, bob.id, {
          pictureUrl: "https://img.clerk.com/photo-two",
        }),
      ),
    ).toBe("reported");
  });

  it("lets two people report the same thing", async () => {
    const bob = await withPicture();
    const ana = await newUser();
    const carl = await newUser();

    expect(await createReport(db, userReport(ana.id, bob.id))).toBe("reported");
    expect(await createReport(db, userReport(carl.id, bob.id))).toBe(
      "reported",
    );
  });

  it("allows 20 a day and refuses the next", async () => {
    const ana = await newUser();
    expect(dailyReportCap).toBe(20);
    const targets = await Promise.all(
      Array.from({ length: 21 }, () => newUser()),
    );

    for (const target of targets.slice(0, 20)) {
      expect(await createReport(db, userReport(ana.id, target.id))).toBe(
        "reported",
      );
    }
    expect(
      await createReport(db, userReport(ana.id, targets[20]?.id ?? "")),
    ).toBe("limit");
    expect(await db.select().from(reports)).toHaveLength(20);
  });

  it("does not count a report older than a day against the limit", async () => {
    const ana = await newUser();
    const targets = await Promise.all(
      Array.from({ length: 21 }, () => newUser()),
    );
    for (const target of targets.slice(0, 20)) {
      await createReport(db, userReport(ana.id, target.id));
    }
    await db.execute(
      sql`UPDATE reports SET created_at = now() - interval '25 hours'`,
    );

    expect(
      await createReport(db, userReport(ana.id, targets[20]?.id ?? "")),
    ).toBe("reported");
  });
});

describe("the picture of a report of minors", () => {
  const minors = (reporterId: string, targetId: string) =>
    pictureReport(reporterId, targetId, { reason: "sexual_minors" });

  it("stops being shown at once, and the report keeps its address", async () => {
    const ana = await newUser();
    const bob = await withPicture();

    await createReport(db, minors(ana.id, bob.id));

    expect(await avatarOf(bob.id)).toBeNull();
    const [row] = await db.select().from(reports);
    expect(row?.pictureUrl).toBe(photo);
  });

  it.each(["sexual_content", "other_person", "violent", "other"] as const)(
    "stays for the reason %s",
    async (reason) => {
      const ana = await newUser();
      const bob = await withPicture();

      await createReport(db, pictureReport(ana.id, bob.id, { reason }));

      expect(await avatarOf(bob.id)).toBe(photo);
    },
  );

  it("only touches the person reported", async () => {
    const ana = await withPicture("https://img.clerk.com/ana");
    const bob = await withPicture();

    await createReport(db, minors(ana.id, bob.id));

    expect(await avatarOf(ana.id)).toBe("https://img.clerk.com/ana");
  });

  it("does not hide a newer picture than the one reported", async () => {
    const ana = await newUser();
    const bob = await withPicture("https://img.clerk.com/newer");

    await createReport(db, minors(ana.id, bob.id));

    expect(await avatarOf(bob.id)).toBe("https://img.clerk.com/newer");
  });

  it("does not hide anything past the limit of the day", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    const others = await Promise.all(
      Array.from({ length: 20 }, () => newUser()),
    );
    for (const other of others) {
      await createReport(db, userReport(ana.id, other.id));
    }

    expect(await createReport(db, minors(ana.id, bob.id))).toBe("limit");
    expect(await avatarOf(bob.id)).toBe(photo);
  });

  it("stays hidden after cancelling is refused", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, minors(ana.id, bob.id));
    const [row] = await db.select().from(reports);

    expect(await cancelReport(db, ana.id, row?.id ?? "")).toBe(false);

    expect(await avatarOf(bob.id)).toBeNull();
    const [after] = await db.select().from(reports);
    expect(after?.cancelledAt).toBeNull();
  });
});

describe("the alert of a report", () => {
  it("reaches each active administrator, with no image and no reporter", async () => {
    const admin = await newUser({ role: "admin" });
    const otherAdmin = await newUser({ role: "admin" });
    const gone = await newUser({ role: "admin" });
    await eraseAccount(db, gone.clerkId);
    const ana = await newUser();
    const bob = await withPicture();

    await createReport(db, pictureReport(ana.id, bob.id));

    const rows = await db.select().from(notifications);
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [admin.id, otherAdmin.id].sort(),
    );
    const [username] = (
      await db.select().from(users).where(eq(users.id, bob.id))
    ).map((row) => row.username);
    expect(rows[0]?.type).toBe("report.created");
    expect(rows[0]?.payload).toEqual({
      kind: "picture",
      reason: "violent",
      username,
    });
    expect(JSON.stringify(rows[0]?.payload)).not.toContain(photo);
    expect(JSON.stringify(rows[0]?.payload)).not.toContain(ana.id);
  });

  it("does not go out again for a duplicate, nor to anybody else", async () => {
    await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();

    await createReport(db, userReport(ana.id, bob.id));
    await createReport(db, userReport(ana.id, bob.id));

    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("works with no administrator at all", async () => {
    const ana = await newUser();
    const bob = await withPicture();

    expect(await createReport(db, userReport(ana.id, bob.id))).toBe("reported");
  });
});

describe("cancelReport", () => {
  async function reported() {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    const [row] = await db.select().from(reports);
    return { ana, bob, id: row?.id ?? "" };
  }

  it("marks the report and keeps the row", async () => {
    const { ana, id } = await reported();

    expect(await cancelReport(db, ana.id, id)).toBe(true);

    const rows = await db.select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cancelledAt).toBeInstanceOf(Date);
  });

  it("lets the person report again, which is how a report is corrected", async () => {
    const { ana, bob, id } = await reported();
    await cancelReport(db, ana.id, id);

    expect(await createReport(db, userReport(ana.id, bob.id))).toBe("reported");

    expect(await db.select().from(reports)).toHaveLength(2);
  });

  it("refuses somebody else's report", async () => {
    const { id } = await reported();
    const carl = await newUser();

    expect(await cancelReport(db, carl.id, id)).toBe(false);

    const [row] = await db.select().from(reports);
    expect(row?.cancelledAt).toBeNull();
  });

  it.each(["reviewing", "resolved", "dismissed"] as const)(
    "refuses a report that is %s",
    async (status) => {
      const { ana, id } = await reported();
      await db.update(reports).set({ status }).where(eq(reports.id, id));

      expect(await cancelReport(db, ana.id, id)).toBe(false);
    },
  );

  it("refuses to cancel twice", async () => {
    const { ana, id } = await reported();
    await cancelReport(db, ana.id, id);

    expect(await cancelReport(db, ana.id, id)).toBe(false);
  });
});

describe("reporting again after an answer (SAG-147, ADR-043)", () => {
  async function answered(status: "resolved" | "dismissed" | "reviewing") {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    await createReport(db, pictureReport(ana.id, bob.id));
    await db.update(reports).set({ status });
    return { ana, bob };
  }

  it.each(["resolved", "dismissed"] as const)(
    "lets the same person report the same user and picture again once it was %s",
    async (status) => {
      const { ana, bob } = await answered(status);

      expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
        "reported",
      );
      expect(await createReport(db, pictureReport(ana.id, bob.id))).toBe(
        "reported",
      );

      // The old rows stay as the record of what was said.
      const rows = await db.select().from(reports);
      expect(rows).toHaveLength(4);
      expect(rows.filter((row) => row.status === status)).toHaveLength(2);
      expect(rows.filter((row) => row.status === "open")).toHaveLength(2);
    },
  );

  it("still says duplicate while the earlier report is open or being reviewed", async () => {
    const { ana, bob } = await answered("reviewing");

    expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
      "duplicate",
    );
    expect(await createReport(db, pictureReport(ana.id, bob.id))).toBe(
      "duplicate",
    );
    expect(await db.select().from(reports)).toHaveLength(2);
  });

  it("blocks the third report while the second is open, and works with a real dismissal", async () => {
    const admin = await newUser({ role: "admin" });
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    const [first] = await db.select().from(reports);
    expect(await dismissReport(db, admin.id, first?.id ?? "")).toBe(true);

    expect(await createReport(db, userReport(ana.id, bob.id))).toBe("reported");
    expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
      "duplicate",
    );
    expect(await db.select().from(reports)).toHaveLength(2);
  });

  it("keeps the limit of the day, so repeating is limited", async () => {
    const ana = await newUser();
    const targets = await Promise.all(
      Array.from({ length: dailyReportCap }, () => newUser()),
    );
    for (const target of targets) {
      await createReport(db, userReport(ana.id, target.id));
    }
    await db.update(reports).set({ status: "dismissed" });

    const again = await createReport(
      db,
      userReport(ana.id, targets[0]?.id ?? ""),
    );

    expect(again).toBe("limit");
  });

  it("keeps working if the migration has not been applied yet, with the old index", async () => {
    // The old index counts every report that is not cancelled. The code names no index, so it
    // works before and after migration 0028, whichever order the owner applies them in.
    const name = sql.identifier("reports_reporter_target_active_unique");
    const columns = sql.raw(
      `"reporter_id","target_type","target_id",coalesce("picture_url", '')`,
    );
    await db.execute(sql`DROP INDEX ${name}`);
    await db.execute(
      sql`CREATE UNIQUE INDEX ${name} ON "reports" USING btree (${columns}) WHERE "cancelled_at" is null`,
    );
    try {
      const ana = await newUser();
      const bob = await withPicture();

      expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
        "reported",
      );
      expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
        "duplicate",
      );
      // With the old index an answered report still blocks: that is the bug the migration fixes.
      await db.update(reports).set({ status: "resolved" });
      expect(await createReport(db, userReport(ana.id, bob.id))).toBe(
        "duplicate",
      );
    } finally {
      await db.execute(sql`DROP INDEX ${name}`);
      await db.execute(
        sql`CREATE UNIQUE INDEX ${name} ON "reports" USING btree (${columns}) WHERE "cancelled_at" is null and "status" in ('open', 'reviewing')`,
      );
    }
  });
});

describe("findMyReports", () => {
  it("finds the reporter's own standing reports, and the current picture only", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    await createReport(db, pictureReport(ana.id, bob.id));

    const mine = await findMyReports(db, ana.id, bob.id, photo);
    expect(mine.user?.reason).toBe("spam");
    expect(mine.picture?.reason).toBe("violent");

    const afterNewPicture = await findMyReports(
      db,
      ana.id,
      bob.id,
      "https://img.clerk.com/photo-two",
    );
    expect(afterNewPicture.user).not.toBeNull();
    expect(afterNewPicture.picture).toBeNull();
  });

  it("tells nobody else, not even the person reported", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    const carl = await newUser();
    await createReport(db, userReport(ana.id, bob.id));

    expect(await findMyReports(db, bob.id, bob.id, photo)).toEqual({
      user: null,
      picture: null,
    });
    expect(await findMyReports(db, carl.id, bob.id, photo)).toEqual({
      user: null,
      picture: null,
    });
    expect(await findMyReports(db, bob.id, ana.id, null)).toEqual({
      user: null,
      picture: null,
    });
  });

  it("forgets an answered report, so the form is offered again, and keeps one being reviewed (SAG-147)", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    await createReport(db, pictureReport(ana.id, bob.id));

    await db
      .update(reports)
      .set({ status: "reviewing" })
      .where(eq(reports.targetType, "user"));
    await db
      .update(reports)
      .set({ status: "resolved" })
      .where(eq(reports.targetType, "picture"));

    const mine = await findMyReports(db, ana.id, bob.id, photo);
    expect(mine.user?.status).toBe("reviewing");
    expect(mine.picture).toBeNull();

    await db.update(reports).set({ status: "dismissed" });
    expect(await findMyReports(db, ana.id, bob.id, photo)).toEqual({
      user: null,
      picture: null,
    });
  });

  it("forgets a cancelled report", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    const [row] = await db.select().from(reports);
    await cancelReport(db, ana.id, row?.id ?? "");

    expect((await findMyReports(db, ana.id, bob.id, photo)).user).toBeNull();
  });
});

describe("the record of picture uploads", () => {
  const record = (userId: string) => ({
    userId,
    sha256: "abc",
    result: "rejected" as const,
    scores: { erotica: 0.9 },
    ipAddress: "203.0.113.7",
  });

  it("keeps who, what and the answer", async () => {
    const ana = await newUser();

    await recordPictureUpload(db, record(ana.id));

    const [row] = await db.select().from(pictureUploads);
    expect(row).toMatchObject({
      userId: ana.id,
      sha256: "abc",
      result: "rejected",
      scores: { erotica: 0.9 },
      ipAddress: "203.0.113.7",
    });
  });

  it("takes a try with no answer and no address", async () => {
    const ana = await newUser();

    await recordPictureUpload(db, {
      ...record(ana.id),
      result: "unavailable",
      scores: null,
      ipAddress: null,
    });

    const [row] = await db.select().from(pictureUploads);
    expect(row?.scores).toBeNull();
    expect(row?.ipAddress).toBeNull();
  });

  it("refuses a result it does not know", async () => {
    const ana = await newUser();

    await expect(
      db.insert(pictureUploads).values({
        userId: ana.id,
        sha256: "abc",
        result: "maybe",
      }),
    ).rejects.toThrow();
  });

  it("deletes after 90 days and not before", async () => {
    const ana = await newUser();
    await recordPictureUpload(db, record(ana.id));
    await recordPictureUpload(db, record(ana.id));
    const [first] = await db.select().from(pictureUploads);
    await db.execute(
      sql`UPDATE picture_uploads SET created_at = now() - interval '89 days'`,
    );
    await db.execute(
      sql`UPDATE picture_uploads SET created_at = now() - interval '91 days'
          WHERE id = ${first?.id ?? ""}::uuid`,
    );

    expect(await prunePictureUploads(db)).toBe(1);

    const rows = await db.select().from(pictureUploads);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(first?.id);
  });

  it("stays after the account is erased, and then goes with the time", async () => {
    const ana = await newUser();
    await recordPictureUpload(db, record(ana.id));

    await eraseAccount(db, ana.clerkId);
    expect(await db.select().from(pictureUploads)).toHaveLength(1);

    await db.execute(
      sql`UPDATE picture_uploads SET created_at = now() - interval '91 days'`,
    );
    await prunePictureUploads(db);
    expect(await db.select().from(pictureUploads)).toHaveLength(0);
  });

  it("makes the same hash the tools would", async () => {
    // The SHA-256 of "abc", from FIPS 180-2.
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("the export and the erasure", () => {
  it("export the reports the person made, and the record of their uploads", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    await recordPictureUpload(db, {
      userId: ana.id,
      sha256: "abc",
      result: "allowed",
      scores: null,
      ipAddress: "203.0.113.7",
    });

    const data = await exportAccount(db, ana.id);

    const [bobRow] = await db.select().from(users).where(eq(users.id, bob.id));
    expect(data?.reportsMade).toEqual([
      expect.objectContaining({
        kind: "user",
        username: bobRow?.username,
        reason: "spam",
        status: "open",
        cancelledAt: null,
      }),
    ]);
    expect(data?.pictureUploads).toEqual([
      expect.objectContaining({
        sha256: "abc",
        result: "allowed",
        ipAddress: "203.0.113.7",
      }),
    ]);
  });

  it("never show a person the reports about them", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));

    const data = await exportAccount(db, bob.id);

    expect(data?.reportsMade).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(ana.username);
  });

  it("leave out the username of an erased person", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, userReport(ana.id, bob.id));
    await eraseAccount(db, bob.clerkId);

    const data = await exportAccount(db, ana.id);

    expect(data?.reportsMade[0]?.username).toBeNull();
  });

  it("keep a report after either account is erased", async () => {
    const ana = await newUser();
    const bob = await withPicture();
    await createReport(db, pictureReport(ana.id, bob.id));

    await eraseAccount(db, ana.clerkId);
    await eraseAccount(db, bob.clerkId);

    const [row] = await db.select().from(reports);
    expect(row?.pictureUrl).toBe(photo);
    expect(row?.status).toBe("open");
  });
});
